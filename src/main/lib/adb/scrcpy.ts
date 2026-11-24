import { Client } from '@devicefarmer/adbkit'
import { handleEvent, resolveResources } from 'share/main/lib/util'
import { getDeviceStore, setDeviceStore } from './base'
import log from 'share/common/log'
import { IpcStartScrcpy } from 'common/types'

const logger = log('scrcpy')

let client: Client

class ScrcpyClient {
  private deviceId = ''
  constructor(deviceId: string) {
    this.deviceId = deviceId
  }
  async start(args: string[]) {
    await this.push()

    logger.info('start', args)

    const device = client.getDevice(this.deviceId)
    const socket = await device.shell(
      `CLASSPATH=/data/local/tmp/aya/scrcpy.jar app_process /system/bin com.genymobile.scrcpy.Server 3.1 ${args.join(
        ' '
      )}`
    )

    // Wait until the server is actually listening before the renderer connects
    // to the adb forward, otherwise the forward is closed immediately.
    await new Promise<void>((resolve) => {
      let output = ''
      let done = false
      const finish = () => {
        if (!done) {
          done = true
          clearTimeout(timer)
          resolve()
        }
      }
      const timer = setTimeout(finish, 8000)
      socket.on('data', (data) => {
        output += data.toString()
        logger.info(data.toString())
        if (/Device:/.test(output)) {
          setTimeout(finish, 300)
        }
      })
      socket.on('end', finish)
      socket.on('error', finish)
      socket.on('close', finish)
    })
  }
  async push() {
    logger.info('push')

    const device = client.getDevice(this.deviceId)
    await device.push(
      resolveResources('scrcpy.jar'),
      '/data/local/tmp/aya/scrcpy.jar'
    )
  }
}

async function getScrcpyClient(deviceId: string): Promise<ScrcpyClient> {
  let scrcpyClient = getDeviceStore(deviceId, 'scrcpyClient')
  if (!scrcpyClient) {
    scrcpyClient = new ScrcpyClient(deviceId)
    setDeviceStore(deviceId, 'scrcpyClient', scrcpyClient)
  }
  return scrcpyClient
}

const startScrcpy: IpcStartScrcpy = async function (deviceId, args) {
  const client = await getScrcpyClient(deviceId)
  await client.start(args)
}

export async function init(c: Client) {
  client = c

  handleEvent('startScrcpy', startScrcpy)
}
