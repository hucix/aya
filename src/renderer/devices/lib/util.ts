import isIp from 'licia/isIp'
import contain from 'licia/contain'
import { IDevice } from 'common/types'

export function isRemoteDevice(deviceId: string) {
  if (!contain(deviceId, ':')) {
    return false
  }

  return isIp.v4(deviceId.split(':')[0])
}

export function isDeviceOnline(device: IDevice) {
  return device.type === 'device' || device.type === 'emulator'
}
