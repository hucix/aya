import BaseStore from 'share/renderer/store/BaseStore'
import { IDevice } from 'common/types'
import { action, makeObservable, observable, runInAction, toJS } from 'mobx'
import ScrcpyClient from './lib/ScrcpyClient'
import { ScrcpyOptions3_1 } from '@yume-chan/scrcpy'
import defaults from 'licia/defaults'
import dataUrl from 'licia/dataUrl'

class Store extends BaseStore {
  device!: IDevice
  scrcpyClient!: ScrcpyClient
  alwaysOnTop = false
  settings = defaultSettings
  screenOff = false
  recording = false
  mode: 'scrcpy' | 'frames' = 'scrcpy'
  frame: string | null = null
  frameSource: 'minicap' | 'screencap' = 'minicap'
  private frameTimer: ReturnType<typeof setTimeout> | null = null
  private minicapFallbackTimer: ReturnType<typeof setTimeout> | null = null
  constructor() {
    super()

    makeObservable(this, {
      alwaysOnTop: observable,
      settings: observable,
      device: observable,
      screenOff: observable,
      recording: observable,
      mode: observable,
      frame: observable,
      frameSource: observable,
      setAlwaysOnTop: action,
      turnOnScreen: action,
      turnOffScreen: action,
      startRecording: action,
      stopRecording: action,
      startFrameMode: action,
      stopFrameMode: action,
    })

    this.init()
    this.bindEvent()
  }
  setAlwaysOnTop(val: boolean) {
    this.alwaysOnTop = val
    main.setScreencastStore('alwaysOnTop', val)
    main.setScreencastAlwaysOnTop(val)
  }
  turnOnScreen() {
    this.screenOff = false
    this.scrcpyClient.turnOnScreen()
  }
  turnOffScreen() {
    this.screenOff = true
    this.scrcpyClient.turnOffScreen()
  }
  startRecording() {
    this.recording = true
    this.scrcpyClient.startRecording()
  }
  stopRecording() {
    this.recording = false
    this.scrcpyClient.stopRecording()
  }
  async setDevice(device: IDevice | null) {
    this.stopFrameMode()
    if (device === null) {
      main.closeScreencast()
    } else {
      const deviceSettings = await main.getScreencastStore('settings')
      let settings = defaultSettings
      if (deviceSettings[device.id]) {
        settings = deviceSettings[device.id]
        defaults(settings, defaultSettings)
      }

      runInAction(() => {
        this.mode = 'scrcpy'
        this.frame = null
      })

      this.scrcpyClient = new ScrcpyClient(
        device.id,
        new ScrcpyOptions3_1({
          // Audio capture only exists since Android 11; asking for it on older
          // devices makes the server wait for a socket that will never connect.
          audio: Number(device.sdkVersion) >= 30,
          tunnelForward: true,
          sendDummyByte: false,
          videoBitRate: settings.videoBitRate,
          maxSize: settings.maxSize,
          clipboardAutosync: true,
          stayAwake: true,
        })
      )
      this.scrcpyClient.on('fallback', () => {
        if (this.device.id === device.id) {
          this.startFrameMode()
        }
      })
      this.scrcpyClient.on('close', () => {
        if (this.device.id === device.id && this.mode === 'scrcpy') {
          this.setDevice(null)
        }
      })

      runInAction(() => {
        this.settings = settings
        this.screenOff = false
        this.device = device
      })
    }
  }
  startFrameMode() {
    if (this.mode === 'frames' || !this.device) {
      return
    }
    this.mode = 'frames'
    this.frame = null
    this.frameSource =
      Number(this.device.sdkVersion) < 21 ? 'minicap' : 'screencap'
    const deviceId = this.device.id

    if (this.frameSource === 'minicap') {
      this.minicapFallbackTimer = setTimeout(() => {
        if (
          this.mode === 'frames' &&
          this.device &&
          this.device.id === deviceId &&
          this.frameSource === 'minicap' &&
          !this.frame
        ) {
          this.startScreencapPolling(deviceId)
        }
      }, 8000)
      main.startMinicap(deviceId).catch(() => {
        this.startScreencapPolling(deviceId)
      })
    } else {
      this.startScreencapPolling(deviceId)
    }
  }
  startScreencapPolling(deviceId: string) {
    if (this.mode !== 'frames' || !this.device || this.device.id !== deviceId) {
      return
    }
    if (this.frameSource === 'minicap') {
      main.stopMinicap(deviceId).catch(() => {})
    }
    this.frameSource = 'screencap'
    if (this.minicapFallbackTimer) {
      clearTimeout(this.minicapFallbackTimer)
      this.minicapFallbackTimer = null
    }
    if (this.frameTimer) {
      clearTimeout(this.frameTimer)
      this.frameTimer = null
    }

    const tick = async () => {
      if (
        this.mode !== 'frames' ||
        !this.device ||
        this.device.id !== deviceId
      ) {
        return
      }
      try {
        const data = await main.screencap(deviceId)
        if (
          this.mode === 'frames' &&
          this.device &&
          this.device.id === deviceId
        ) {
          runInAction(() => {
            this.frame = dataUrl.stringify(data, 'image/png')
          })
        }
      } catch {
        // Keep the last frame on transient failures.
      }
      if (
        this.mode === 'frames' &&
        this.device &&
        this.device.id === deviceId
      ) {
        this.frameTimer = setTimeout(tick, 700)
      }
    }

    void tick()
  }
  stopFrameMode() {
    const deviceId = this.device?.id
    this.mode = 'scrcpy'
    this.frame = null
    this.frameSource = 'minicap'
    if (this.frameTimer) {
      clearTimeout(this.frameTimer)
      this.frameTimer = null
    }
    if (this.minicapFallbackTimer) {
      clearTimeout(this.minicapFallbackTimer)
      this.minicapFallbackTimer = null
    }
    if (deviceId) {
      main.stopMinicap(deviceId).catch(() => {})
    }
  }
  async setSettings(name: string, val: any) {
    runInAction(() => (this.settings[name] = val))
    const deviceSettings = await main.getScreencastStore('settings')
    deviceSettings[this.device.id] = toJS(this.settings)
    main.setScreencastStore('settings', deviceSettings)
  }
  private async init() {
    const device = await main.getMainStore('device')
    this.setDevice(device)
    const alwaysOnTop = await main.getScreencastStore('alwaysOnTop')
    if (alwaysOnTop) {
      main.setScreencastAlwaysOnTop(true)
      runInAction(() => (this.alwaysOnTop = true))
    }
  }
  private bindEvent() {
    main.on('minicapFrame', (payload: { deviceId: string; data: string }) => {
      if (
        this.mode !== 'frames' ||
        !this.device ||
        this.device.id !== payload.deviceId
      ) {
        return
      }
      if (this.minicapFallbackTimer) {
        clearTimeout(this.minicapFallbackTimer)
        this.minicapFallbackTimer = null
      }
      runInAction(() => {
        this.frameSource = 'minicap'
        this.frame = dataUrl.stringify(payload.data, 'image/jpeg')
      })
    })
    main.on('changeMainStore', (name: string, val: any) => {
      if (name === 'device') {
        this.setDevice(val)
      }
    })
    main.on('focusWin', async () => {
      const text = await navigator.clipboard.readText()
      this.scrcpyClient.setClipboard(text)
    })
  }
}

const defaultSettings = {
  videoBitRate: 8000000,
  maxSize: 0,
}

export default new Store()
