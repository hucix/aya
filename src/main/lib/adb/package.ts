import { Client } from '@devicefarmer/adbkit'
import { shell, execAdb } from './base'
import singleton from 'licia/singleton'
import each from 'licia/each'
import trim from 'licia/trim'
import contain from 'licia/contain'
import startWith from 'licia/startWith'
import { handleEvent } from 'share/main/lib/util'
import {
  IPackageTaskResult,
  IpcClearPackage,
  IpcDisablePackage,
  IpcEnablePackage,
  IpcGetPackageStates,
  IpcGetPackages,
  IpcGetTopPackage,
  IpcInstallPackage,
  IpcBeginInstallVerification,
  IpcEndInstallVerification,
  IpcRunPackageTask,
  IpcStartPackage,
  IpcStopPackage,
  IpcUninstallPackage,
  PackageState,
  PackageTaskStatus,
} from 'common/types'

let client: Client

const getCurrentUser = singleton(async (deviceId: string) => {
  const result = await shell(deviceId, 'am get-current-user')
  const user = parseInt(trim(result), 10)

  // Android 5.x/6.x does not support `am get-current-user`; fall back to 0.
  return Number.isNaN(user) ? 0 : user
})

export const getPackages = singleton(<IpcGetPackages>(async (
  deviceId,
  system = true
) => {
  const result: string = await shell(
    deviceId,
    `pm list packages${system ? '' : ' -3'} --user ${await getCurrentUser(
      deviceId
    )}`
  )

  const packages: string[] = []
  each(result.split('\n'), (line) => {
    line = trim(line)
    if (startWith(line, 'package:')) {
      packages.push(line.slice(8))
    }
  })

  return packages
}))

const stopPackage: IpcStopPackage = async function (deviceId, pkg) {
  await shell(deviceId, `am force-stop ${pkg}`)
}

const clearPackage: IpcClearPackage = async function (deviceId, pkg) {
  const device = await client.getDevice(deviceId)
  await device.clear(pkg)
}

const startPackage: IpcStartPackage = async function (deviceId, pkg) {
  const component = await getMainComponent(deviceId, pkg)
  const device = await client.getDevice(deviceId)
  await device.startActivity({
    component,
  })
}

const installPackage: IpcInstallPackage = async function (deviceId, apkPath) {
  const device = await client.getDevice(deviceId)
  await device.install(apkPath)
}

const uninstallPackage: IpcUninstallPackage = async function (deviceId, pkg) {
  const device = await client.getDevice(deviceId)
  await device.uninstall(pkg)
}

async function getMainComponent(deviceId: string, pkg: string) {
  const result = await shell(
    deviceId,
    `dumpsys package ${pkg} | grep -A 1 MAIN`
  )
  const lines = result.split('\n')
  for (let i = 0, len = lines.length; i < len; i++) {
    const line = trim(lines[i])
    if (contain(line, `${pkg}/`)) {
      return line.substring(line.indexOf(`${pkg}/`), line.indexOf(' filter'))
    }
  }

  throw new Error('Failed to get main activity')
}

export const getTopPackage = singleton(<IpcGetTopPackage>(
  async function (deviceId) {
    const topActivity = await shell(deviceId, 'dumpsys activity')
    const lines = topActivity.split('\n')
    let line = ''
    for (let i = 0, len = lines.length; i < len; i++) {
      if (contain(lines[i], 'top-activity')) {
        line = trim(lines[i])
        break
      }
    }

    if (!line) {
      return {
        name: '',
        pid: 0,
      }
    }

    let parts = line.split(/\s+/)
    parts = parts[parts.length - 2].split(':')
    const pid = parseInt(parts[0], 10)
    let name = parts[1]
    if (contain(name, '/')) {
      name = name.split('/')[0]
    }

    return {
      name,
      pid,
    }
  }
))

const disablePackage: IpcDisablePackage = async function (deviceId, pkg) {
  await shell(deviceId, `pm disable-user ${pkg}`)
}

const enablePackage: IpcEnablePackage = async function (deviceId, pkg) {
  await shell(deviceId, `pm enable ${pkg}`)
}

function parsePackageList(output: string) {
  const ret: string[] = []
  each(output.split('\n'), (line) => {
    line = trim(line)
    if (startWith(line, 'package:')) {
      ret.push(line.slice(8))
    }
  })

  return ret
}

// Tell whether each package is a system app, a user app or not installed at all.
// Using `pm list packages` (all) and `pm list packages -3` (third party) avoids
// the adbkit `getPackages` singleton cache, which may be stale after batch tasks.
const getPackageStates: IpcGetPackageStates = async function (
  deviceId,
  packages
) {
  const [all, thirdParty] = (await shell(deviceId, [
    'pm list packages',
    'pm list packages -3',
  ])) as string[]
  const allSet = new Set(parsePackageList(all))
  const thirdPartySet = new Set(parsePackageList(thirdParty))
  const states: Record<string, PackageState> = {}

  each(packages, (pkg) => {
    if (!allSet.has(pkg)) {
      states[pkg] = 'missing'
    } else if (thirdPartySet.has(pkg)) {
      states[pkg] = 'user'
    } else {
      states[pkg] = 'system'
    }
  })

  return states
}

function getFailureReason(output: string) {
  const match = output.match(/Failure \[(.+?)\]/)

  return match ? trim(match[1]) : ''
}

const runPackageTask: IpcRunPackageTask = async function (task) {
  const started = Date.now()
  let args: string[]
  if (task.action === 'install') {
    // `-r -d` keeps the overwrite semantic and allows downgrading to an older
    // build, which is what users usually expect from a batch install.
    args = ['install', '-r', '-d', task.target]
  } else if (task.action === 'disable') {
    args = ['shell', 'pm', 'disable-user', task.target]
  } else {
    args = ['uninstall', task.target]
  }

  const controller = new AbortController()
  let offlineCount = 0
  let checking = false
  // Abort quickly when the device vanishes mid-command (reboot, adbd crash,
  // Wi-Fi drop) instead of waiting for the whole task timeout.
  const watchdog = setInterval(async () => {
    if (checking || controller.signal.aborted) {
      return
    }
    checking = true
    try {
      const state = await client.getDevice(task.deviceId).getState()
      if (state === 'device' || state === 'emulator') {
        offlineCount = 0
      } else {
        offlineCount++
      }
    } catch {
      offlineCount++
    } finally {
      checking = false
    }
    if (offlineCount >= 2) {
      controller.abort()
    }
  }, 2000)

  let result: Awaited<ReturnType<typeof execAdb>>
  try {
    result = await execAdb(args, {
      serial: task.deviceId,
      timeout: task.timeout,
      stallPattern: /waiting for device/i,
      stallTimeout: 8000,
      signal: controller.signal,
    })
  } finally {
    clearInterval(watchdog)
  }
  const output = [result.stdout, result.stderr]
    .filter((text) => trim(text) !== '')
    .join('\n')
    .trim()
  const duration = Date.now() - started

  const ret = (
    status: PackageTaskStatus,
    message: string
  ): IPackageTaskResult => ({
    deviceId: task.deviceId,
    action: task.action,
    target: task.target,
    status,
    message,
    output,
    duration,
  })

  const installHint =
    task.action === 'install'
      ? ' If this keeps happening, enable "Skip Play Protect verification" and retry.'
      : ''

  if (result.aborted) {
    return ret(
      'failure',
      `Device went offline during the command.${installHint}`
    )
  }
  if (result.timedOut) {
    return ret(
      'failure',
      `Timed out after ${
        task.timeout || 0
      }ms, adb process killed.${installHint}`
    )
  }
  if (result.stalled) {
    return ret(
      'failure',
      `Device disconnected during the command (adb was waiting for device).${installHint}`
    )
  }

  const text = `${result.stdout}\n${result.stderr}`
  const notInstalled = /not installed|unknown package|does not exist/i.test(
    text
  )

  if (task.action === 'install') {
    if (/Failure \[/i.test(text)) {
      return ret('failure', getFailureReason(text) || trim(text))
    }
    if (/\bSuccess\b/i.test(text)) {
      return ret('success', 'Success')
    }
    if (/Exception/i.test(text)) {
      const line = text.split('\n').find((l) => /Exception/i.test(l)) || ''
      return ret('failure', trim(line) || 'Install failed')
    }

    return ret(
      result.code === 0 ? 'success' : 'failure',
      trim(text) || `Exit code ${result.code}`
    )
  }

  if (task.action === 'uninstall') {
    if (/\bSuccess\b/i.test(text)) {
      return ret('success', 'Success')
    }
    if (notInstalled) {
      return ret('skipped', trim(text) || 'Package not installed')
    }
    if (result.code === 0 && !/Failure|Exception|Error/i.test(text)) {
      return ret('success', trim(text) || 'Success')
    }

    return ret(
      'failure',
      getFailureReason(text) || trim(text) || `Exit code ${result.code}`
    )
  }

  if (/new state: disabled/i.test(text) || /\bSuccess\b/i.test(text)) {
    return ret('success', 'Success')
  }
  if (notInstalled) {
    return ret('skipped', trim(text) || 'Package not installed')
  }
  if (result.code === 0 && !/Failure|Exception|Error/i.test(text)) {
    return ret('success', trim(text) || 'Success')
  }

  return ret(
    'failure',
    getFailureReason(text) || trim(text) || `Exit code ${result.code}`
  )
}

const beginInstallVerification: IpcBeginInstallVerification = async function (
  deviceId
) {
  const result = await execAdb(
    ['shell', 'settings', 'get', 'global', 'verifier_verify_adb_installs'],
    { serial: deviceId, timeout: 8000 }
  )
  const original = trim(result.stdout) || 'null'
  await execAdb(
    ['shell', 'settings', 'put', 'global', 'verifier_verify_adb_installs', '0'],
    { serial: deviceId, timeout: 8000 }
  )

  return original
}

const endInstallVerification: IpcEndInstallVerification = async function (
  deviceId,
  original
) {
  const args =
    original === 'null' || original === ''
      ? [
          'shell',
          'settings',
          'delete',
          'global',
          'verifier_verify_adb_installs',
        ]
      : [
          'shell',
          'settings',
          'put',
          'global',
          'verifier_verify_adb_installs',
          original,
        ]
  await execAdb(args, { serial: deviceId, timeout: 8000 })
}

export async function init(c: Client) {
  client = c

  handleEvent('getPackages', getPackages)
  handleEvent('stopPackage', stopPackage)
  handleEvent('startPackage', startPackage)
  handleEvent('installPackage', installPackage)
  handleEvent('uninstallPackage', uninstallPackage)
  handleEvent('getTopPackage', getTopPackage)
  handleEvent('clearPackage', clearPackage)
  handleEvent('disablePackage', disablePackage)
  handleEvent('enablePackage', enablePackage)
  handleEvent('getPackageStates', getPackageStates)
  handleEvent('beginInstallVerification', beginInstallVerification)
  handleEvent('endInstallVerification', endInstallVerification)
  handleEvent('runPackageTask', runPackageTask)
}
