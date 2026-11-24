import { ChildProcess, spawn } from 'node:child_process'
import net from 'node:net'
import { handleEvent, resolveResources } from 'share/main/lib/util'
import * as window from 'share/main/lib/window'
import { IpcStartMinicap, IpcStopMinicap } from 'common/types'
import { execAdb, forwardPort } from './base'
import log from 'share/common/log'
import sleep from 'licia/sleep'

const logger = log('minicap')

interface IMinicapSession {
  child: ChildProcess
  port: number
  socket?: net.Socket
  buffer: Buffer
  header: boolean
  pid: number
  width: number
  height: number
}

const sessions = new Map<string, IMinicapSession>()

function getAdbPath() {
  return resolveResources(
    process.platform === 'win32' ? 'adb/adb.exe' : 'adb/adb'
  )
}

async function getScreenSize(deviceId: string) {
  try {
    const result = await execAdb(['shell', 'wm', 'size'], {
      serial: deviceId,
      timeout: 5000,
    })
    const match = result.stdout.match(/(\d+)x(\d+)/)
    if (match) {
      return {
        width: parseInt(match[1], 10),
        height: parseInt(match[2], 10),
      }
    }
  } catch {
    // Fall through to the common 1080p size.
  }

  return { width: 1920, height: 1080 }
}

function parseFrames(session: IMinicapSession, deviceId: string) {
  if (!session.header) {
    if (session.buffer.length < 24) {
      return
    }
    const headerSize = session.buffer[1] || 24
    session.pid = session.buffer.readUInt32LE(2)
    session.width = session.buffer.readUInt32LE(14)
    session.height = session.buffer.readUInt32LE(18)
    session.header = true
    session.buffer = session.buffer.slice(headerSize)
    logger.info(`header ${session.width}x${session.height} pid=${session.pid}`)
  }

  while (session.buffer.length >= 4) {
    const length = session.buffer.readUInt32LE(0)
    if (length <= 0 || length > 10 * 1024 * 1024) {
      logger.warn('invalid frame length', length)
      return
    }
    if (session.buffer.length < 4 + length) {
      return
    }
    const jpeg = session.buffer.slice(4, 4 + length)
    session.buffer = session.buffer.slice(4 + length)
    window.sendTo('screencast', 'minicapFrame', {
      deviceId,
      data: jpeg.toString('base64'),
    })
  }
}

async function connect(session: IMinicapSession, deviceId: string) {
  for (let i = 0; i < 20; i++) {
    const connected = await new Promise<boolean>((resolve) => {
      const socket = net.connect(session.port, '127.0.0.1')
      let settled = false
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true
          socket.destroy()
          resolve(false)
        }
      }, 1500)

      socket.once('data', (data) => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timer)
        session.socket = socket
        session.buffer = Buffer.concat([session.buffer, data])
        parseFrames(session, deviceId)
        socket.on('data', (chunk) => {
          session.buffer = Buffer.concat([session.buffer, chunk])
          parseFrames(session, deviceId)
        })
        socket.on('close', () => {
          if (sessions.get(deviceId) === session) {
            sessions.delete(deviceId)
          }
        })
        resolve(true)
      })
      socket.once('error', () => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          resolve(false)
        }
      })
    })

    if (connected) {
      return
    }
    await sleep(300)
  }

  throw new Error('minicap socket connect timeout')
}

async function start(deviceId: string) {
  const existing = sessions.get(deviceId)
  if (existing) {
    return { width: existing.width, height: existing.height }
  }

  const size = await getScreenSize(deviceId)
  const binary = resolveResources('minicap/minicap')
  const library = resolveResources('minicap/minicap.so')

  await execAdb(['push', binary, '/data/local/tmp/minicap'], {
    serial: deviceId,
    timeout: 30000,
  })
  await execAdb(['push', library, '/data/local/tmp/minicap.so'], {
    serial: deviceId,
    timeout: 30000,
  })
  await execAdb(['shell', 'chmod', '755', '/data/local/tmp/minicap'], {
    serial: deviceId,
  })

  const child = spawn(
    getAdbPath(),
    [
      '-s',
      deviceId,
      'shell',
      `LD_LIBRARY_PATH=/data/local/tmp /data/local/tmp/minicap -P ${size.width}x${size.height}@${size.width}x${size.height}/0 -S`,
    ],
    { stdio: 'ignore' }
  )

  const session: IMinicapSession = {
    child,
    port: 0,
    buffer: Buffer.alloc(0),
    header: false,
    pid: 0,
    width: size.width,
    height: size.height,
  }

  session.port = await forwardPort(deviceId, 'localabstract:minicap')
  sessions.set(deviceId, session)
  logger.info('start', deviceId, session.port)

  try {
    await connect(session, deviceId)
  } catch (e) {
    await stop(deviceId)
    throw e
  }

  return { width: size.width, height: size.height }
}

async function stop(deviceId: string) {
  const session = sessions.get(deviceId)
  if (!session) {
    return
  }
  sessions.delete(deviceId)

  if (session.socket) {
    session.socket.destroy()
  }
  if (session.child && !session.child.killed) {
    session.child.kill()
  }
  if (session.pid) {
    execAdb(['shell', 'kill', String(session.pid)], {
      serial: deviceId,
      timeout: 3000,
    }).catch(() => {})
  }
  if (session.port) {
    execAdb(['forward', '--remove', `tcp:${session.port}`], {
      serial: deviceId,
      timeout: 3000,
    }).catch(() => {})
  }
}

export function stopAll() {
  for (const deviceId of sessions.keys()) {
    stop(deviceId).catch(() => {})
  }
}

const startMinicap: IpcStartMinicap = start
const stopMinicap: IpcStopMinicap = stop

export function init() {
  handleEvent('startMinicap', startMinicap)
  handleEvent('stopMinicap', stopMinicap)
}
