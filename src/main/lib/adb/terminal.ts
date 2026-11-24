import { handleEvent } from 'share/main/lib/util'
import { execAdb } from './base'
import { IpcRunShellCommand } from 'common/types'

// Runs one shell command on a single device with a hard timeout. Used by the
// batch terminal in the device manager.
const runShellCommand: IpcRunShellCommand = async function (
  deviceId,
  command,
  timeout = 20000
) {
  const result = await execAdb(['shell', command], {
    serial: deviceId,
    timeout,
  })

  return {
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
    timedOut: result.timedOut,
  }
}

export function init() {
  handleEvent('runShellCommand', runShellCommand)
}
