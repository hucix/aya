import net from 'node:net'
import os from 'node:os'
import toNum from 'licia/toNum'
import unique from 'licia/unique'
import log from 'share/common/log'
import * as window from 'share/main/lib/window'
import { handleEvent } from 'share/main/lib/util'
import { execAdb } from './adb/base'
import {
  DiscoverSource,
  IDiscoveredDevice,
  IDiscoverUpdate,
  IpcGetDiscoverState,
  IpcStartDiscover,
  IpcStopDiscover,
} from 'common/types'

const logger = log('discovery')

const SCAN_PORT = 5555
const PROBE_TIMEOUT = 400
const MDNS_TIMEOUT = 10000
const MAX_HOSTS = 1024

interface ICandidate {
  host: string
  ports: number[]
  source: DiscoverSource
  device: IDiscoveredDevice
}

let scanning = false
let scanned = 0
let total = 0
let error = ''
let candidates = new Map<string, ICandidate>()
let probeConcurrency = 32
let scanToken = 0

function getState(): IDiscoverUpdate {
  const devices = Array.from(candidates.values()).map(({ device }) => ({
    ...device,
  }))

  return {
    scanning,
    scanned,
    total,
    connected: devices.filter(({ state }) => state === 'connected').length,
    failed: devices.filter(({ state }) => state === 'failed').length,
    devices,
    error,
  }
}

function push() {
  window.sendTo('devices', 'discoverUpdate', getState())
}

function ensureCandidate(
  host: string,
  port: number,
  source: DiscoverSource
): ICandidate {
  let candidate = candidates.get(host)
  if (!candidate) {
    candidate = {
      host,
      ports: [],
      source,
      device: {
        id: `${host}:${port}`,
        host,
        port,
        name: '',
        serialno: '',
        androidVersion: '',
        sdkVersion: '',
        type: 'offline',
        source,
        state: 'found',
        message: '',
      },
    }
    candidates.set(host, candidate)
  }

  if (candidate.ports.indexOf(port) === -1) {
    candidate.ports.push(port)
  }
  if (source === 'mdns') {
    candidate.source = source
    candidate.device.source = source
  }

  return candidate
}

async function scanMdns(current: number) {
  let result: Awaited<ReturnType<typeof execAdb>>
  try {
    result = await execAdb(['mdns', 'services'], { timeout: MDNS_TIMEOUT })
  } catch (e) {
    if (current === scanToken) {
      error = 'Failed to run adb mdns services'
      logger.error('mdns failed', e)
      push()
    }
    return
  }

  if (current !== scanToken) {
    return
  }
  if (result.timedOut) {
    error = 'adb mdns services timed out'
    push()
    return
  }

  let found = 0
  result.stdout.split('\n').forEach((line) => {
    const match = line.match(/(\S+)\s+_adb-tls-connect\._tcp\.?\s+(\S+)/)
    if (!match) {
      return
    }
    const address = match[2]
    const idx = address.lastIndexOf(':')
    if (idx < 0) {
      return
    }
    const host = address.slice(0, idx)
    const port = toNum(address.slice(idx + 1)) || SCAN_PORT
    if (!host) {
      return
    }
    found++
    ensureCandidate(host, port, 'mdns')
  })

  logger.info('mdns candidates', found)
  push()
}

function isIgnoredHost(host: string) {
  if (
    host.startsWith('127.') ||
    host.startsWith('169.254.') ||
    host.startsWith('0.')
  ) {
    return true
  }
  // CGNAT (Tailscale and some VPNs), scanning it is both slow and useless.
  const parts = host.split('.').map((part) => toNum(part))
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) {
    return true
  }

  return false
}

function getSubnetHosts() {
  const hosts: string[] = []
  const interfaces = os.networkInterfaces()

  Object.keys(interfaces).forEach((name) => {
    const addresses = interfaces[name] || []
    addresses.forEach((address) => {
      if (address.family !== 'IPv4' || address.internal) {
        return
      }
      if (isIgnoredHost(address.address)) {
        return
      }
      const parts = address.address.split('.')
      if (parts.length !== 4) {
        return
      }
      const base = parts.slice(0, 3).join('.')
      for (let i = 1; i < 255; i++) {
        const host = `${base}.${i}`
        if (host !== address.address) {
          hosts.push(host)
        }
      }
    })
  })

  return unique(hosts).slice(0, MAX_HOSTS)
}

function probe(host: string, port: number, timeout: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false
    const finish = (open: boolean) => {
      if (settled) {
        return
      }
      settled = true
      socket.destroy()
      resolve(open)
    }

    socket.setTimeout(timeout)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(port, host)
  })
}

async function scanSubnet(current: number) {
  const hosts = getSubnetHosts()
  total = hosts.length
  scanned = 0
  logger.info('subnet hosts', total)
  push()

  let index = 0
  const concurrency = Math.max(4, Math.min(probeConcurrency, 64))

  const worker = async () => {
    for (;;) {
      if (current !== scanToken) {
        return
      }
      const i = index++
      if (i >= hosts.length) {
        return
      }
      const host = hosts[i]
      const open = await probe(host, SCAN_PORT, PROBE_TIMEOUT)
      if (current !== scanToken) {
        return
      }
      scanned++
      if (open) {
        ensureCandidate(host, SCAN_PORT, 'scan')
        push()
      }
      if (scanned % 8 === 0) {
        push()
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  if (current === scanToken) {
    push()
  }
}

async function run(current: number) {
  try {
    await scanMdns(current)
    if (current !== scanToken) {
      return
    }
    await scanSubnet(current)
  } catch (e) {
    if (current === scanToken) {
      error = e instanceof Error ? e.message : String(e)
      logger.error('scan failed', e)
    }
  } finally {
    if (current === scanToken) {
      scanning = false
      push()
    }
  }
}

const start: IpcStartDiscover = async (options = {}) => {
  if (scanning) {
    return
  }

  scanning = true
  scanned = 0
  total = 0
  error = ''
  candidates = new Map()
  probeConcurrency =
    options.concurrency && options.concurrency > 0 ? options.concurrency : 32

  const current = ++scanToken
  push()
  void run(current)
}

const stop: IpcStopDiscover = async () => {
  if (!scanning) {
    return
  }

  scanToken++
  scanning = false
  push()
}

const getDiscoverState: IpcGetDiscoverState = async () => getState()

export async function init() {
  handleEvent('startDiscover', start)
  handleEvent('stopDiscover', stop)
  handleEvent('getDiscoverState', getDiscoverState)
}
