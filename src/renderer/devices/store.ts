import { action, makeObservable, observable, runInAction, toJS } from 'mobx'
import BaseStore from 'share/renderer/store/BaseStore'
import {
  DeviceConnectState,
  IDevice,
  IDiscoverUpdate,
  IPackageTaskResult,
  PackageAction,
  PackageState,
} from 'common/types'
import each from 'licia/each'
import filter from 'licia/filter'
import concat from 'licia/concat'
import unique from 'licia/unique'
import find from 'licia/find'
import findIdx from 'licia/findIdx'
import isEmpty from 'licia/isEmpty'
import trim from 'licia/trim'
import map from 'licia/map'
import toNum from 'licia/toNum'
import dataUrl from 'licia/dataUrl'
import isStr from 'licia/isStr'
import { t } from 'common/util'
import { notify } from 'share/renderer/lib/util'
import { isDeviceOnline, isRemoteDevice } from './lib/util'
import { ITerminalPreset, defaultTerminalPresets } from './lib/terminal'

export type BatchType = 'install' | 'uninstall'
export type BatchCellStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failure'
  | 'skipped'

export interface IBatchTask {
  id: string
  label: string
  action: PackageAction
}

export interface IBatchCell {
  key: string
  deviceId: string
  deviceName: string
  taskId: string
  taskLabel: string
  action: PackageAction
  status: BatchCellStatus
  message: string
  output: string
  duration: number
}

export interface IBatchPreflight {
  devices: number
  tasks: number
  system: number
  missing: number
}

export type BatchSection = 'install' | 'uninstall' | 'terminal'

export interface ITerminalResult {
  deviceId: string
  deviceName: string
  command: string
  status: 'pending' | 'running' | 'success' | 'failure'
  output: string
  duration: number
}

export interface IDeviceConnectResult {
  state: DeviceConnectState
  message: string
}

const PACKAGE_REG = /^[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)+$/
const PREFLIGHT_TIMEOUT = 10000
const EMPTY_DISCOVER: IDiscoverUpdate = {
  scanning: false,
  scanned: 0,
  total: 0,
  connected: 0,
  failed: 0,
  devices: [],
  error: '',
}

function withTimeout<T>(
  promise: Promise<T>,
  timeout: number,
  fallback: T
): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), timeout)
    promise.then(
      (val) => {
        clearTimeout(timer)
        resolve(val)
      },
      () => {
        clearTimeout(timer)
        resolve(fallback)
      }
    )
  })
}

class Store extends BaseStore {
  filter = ''
  ip = ''
  port = ''
  devices: IDevice[] = []
  remoteDevices: IDevice[] = []
  screenshotWeight = 40
  device: IDevice | null = null
  screenshot: string | null = null
  selectedIds: string[] = []
  lastSelectedId = ''
  discoveredIds: string[] = []
  connectingIds: string[] = []
  connectResults: Record<string, IDeviceConnectResult> = {}
  discover: IDiscoverUpdate = EMPTY_DISCOVER
  batchVisible = false
  batchType: BatchType = 'install'
  batchSection: BatchSection = 'install'
  terminalCommand = ''
  terminalResults: ITerminalResult[] = []
  terminalRunning = false
  terminalPresets: ITerminalPreset[] = defaultTerminalPresets()
  batchApks: string[] = []
  batchPackages = ''
  batchConcurrency = 1
  batchTimeout = 120
  batchAllowSystemUninstall = false
  batchSkipVerification = false
  batchRunning = false
  batchProgress = { done: 0, total: 0 }
  batchCells: IBatchCell[] = []
  batchActiveKey = ''
  batchPreflight: IBatchPreflight | null = null
  private packageStates: Record<string, Record<string, PackageState>> = {}
  private discoverErrorShown = ''
  constructor() {
    super()
    makeObservable(this, {
      ip: observable,
      port: observable,
      devices: observable,
      device: observable,
      remoteDevices: observable,
      filter: observable,
      screenshotWeight: observable,
      screenshot: observable,
      selectedIds: observable,
      lastSelectedId: observable,
      discoveredIds: observable,
      connectingIds: observable,
      connectResults: observable,
      discover: observable,
      batchVisible: observable,
      batchType: observable,
      batchSection: observable,
      terminalCommand: observable,
      terminalResults: observable,
      terminalRunning: observable,
      terminalPresets: observable,
      batchApks: observable,
      batchPackages: observable,
      batchConcurrency: observable,
      batchTimeout: observable,
      batchAllowSystemUninstall: observable,
      batchSkipVerification: observable,
      batchRunning: observable,
      batchProgress: observable,
      batchCells: observable,
      batchActiveKey: observable,
      batchPreflight: observable,
      setIp: action,
      setPort: action,
      setFilter: action,
      selectDevice: action,
      updateDevices: action,
      removeRemoteDevice: action,
      setScreenshotWeight: action,
      toggleDeviceSelection: action,
      selectRangeTo: action,
      selectAllDevices: action,
      clearSelection: action,
      connectDeviceById: action,
      connectAddress: action,
      applyDiscoverUpdate: action,
      openBatch: action,
      closeBatch: action,
      setBatchType: action,
      setBatchSection: action,
      setTerminalCommand: action,
      setTerminalPresets: action,
      runTerminal: action,
      clearTerminalResults: action,
      addBatchApks: action,
      removeBatchApk: action,
      clearBatchApks: action,
      setBatchPackages: action,
      setBatchConcurrency: action,
      setBatchTimeout: action,
      setBatchAllowSystemUninstall: action,
      setBatchSkipVerification: action,
      setBatchActiveKey: action,
    })

    this.init()
    this.bindEvent()
  }
  async init() {
    const remoteDevices: IDevice[] = await main.getDevicesStore('remoteDevices')
    const screenshotWeight: number = await main.getDevicesStore(
      'screenshotWeight'
    )
    const savedTerminalPresets: ITerminalPreset[] = await main.getSettingsStore(
      'terminalPresets'
    )
    runInAction(() => {
      if (remoteDevices) {
        this.remoteDevices = remoteDevices
      }
      if (screenshotWeight) {
        this.screenshotWeight = screenshotWeight
      }
      if (Array.isArray(savedTerminalPresets)) {
        const valid = savedTerminalPresets.filter(
          (preset) => preset && preset.label && preset.command
        )
        if (!isEmpty(valid)) {
          this.terminalPresets = valid
        }
      }
    })

    const devices: IDevice[] = await main.getMemStore('devices')
    this.updateDevices(devices)

    try {
      const discover: IDiscoverUpdate = await main.getDiscoverState()
      if (discover) {
        this.applyDiscoverUpdate(discover)
      }
    } catch {
      // Ignore when the discovery module is not ready yet.
    }
  }
  setIp(ip: string) {
    this.ip = ip
  }
  setPort(port: string) {
    this.port = port
  }
  setFilter(filter: string) {
    this.filter = filter
  }
  selectDevice(device: IDevice | string | null) {
    if (isStr(device)) {
      const devices: IDevice[] = concat(this.devices, this.remoteDevices)
      device = find(devices, (d) => d.id === device) || null
    }
    if (device && isRemoteDevice(device.id) && device.type === 'offline') {
      const [ip, port] = device.id.split(':')
      this.ip = ip
      this.port = port
    }
    this.device = device

    this.screenshot = null
    if (device && device.type !== 'offline') {
      main.screencap(device.id).then((data) => {
        const url = dataUrl.stringify(data, 'image/png')
        runInAction(() => {
          this.screenshot = url
        })
      })
    }
  }
  updateDevices(devices: IDevice[]) {
    let remoteDevices: IDevice[] = toJS(this.remoteDevices)
    each(remoteDevices, (device) => {
      device.type = 'offline'
    })
    remoteDevices = unique(
      remoteDevices,
      (a, b) => !!a.serialno && a.serialno === b.serialno
    )
    remoteDevices = unique(
      concat(
        remoteDevices,
        filter(devices, (device) => isRemoteDevice(device.id))
      ),
      (a, b) => a.id === b.id
    )
    this.devices = filter(devices, (device) => !isRemoteDevice(device.id))

    this.remoteDevices = remoteDevices
    main.setDevicesStore('remoteDevices', remoteDevices)

    this.selectedIds = filter(
      this.selectedIds,
      (id) =>
        !!find(concat(this.devices, this.remoteDevices), (d) => d.id === id)
    )

    const existingIds = map(
      concat(this.devices, this.remoteDevices),
      (item) => item.id
    )
    this.discoveredIds = filter(this.discoveredIds, (id) =>
      existingIds.includes(id)
    )
    this.connectingIds = filter(this.connectingIds, (id) =>
      existingIds.includes(id)
    )
    const connectResults: Record<string, IDeviceConnectResult> = {}
    each(Object.keys(this.connectResults), (id) => {
      if (existingIds.includes(id)) {
        connectResults[id] = this.connectResults[id]
      }
    })
    this.connectResults = connectResults

    if (this.device) {
      const id = this.device.id
      each(concat(remoteDevices, this.devices), (device) => {
        if (device.id === id) {
          this.selectDevice(device)
        }
      })
    }
  }
  removeRemoteDevice(id: string) {
    this.remoteDevices = filter(this.remoteDevices, (device) => {
      return device.id !== id
    })
    main.setDevicesStore('remoteDevices', toJS(this.remoteDevices))
    this.selectedIds = filter(
      this.selectedIds,
      (selectedId) => selectedId !== id
    )
    this.discoveredIds = filter(
      this.discoveredIds,
      (discoveredId) => discoveredId !== id
    )
    this.connectingIds = filter(
      this.connectingIds,
      (connectingId) => connectingId !== id
    )
    if (this.connectResults[id]) {
      const results = { ...this.connectResults }
      delete results[id]
      this.connectResults = results
    }
  }
  setScreenshotWeight(weight: number) {
    this.screenshotWeight = weight
    main.setDevicesStore('screenshotWeight', weight)
  }
  allDevices() {
    return unique(
      concat(this.devices, this.remoteDevices),
      (a, b) => a.id === b.id
    )
  }
  visibleDevices() {
    const keyword = this.filter.toLowerCase()
    return filter(this.allDevices(), (device) => {
      if (!keyword) {
        return true
      }
      const text = [
        device.id,
        device.serialno,
        device.name,
        `Android ${device.androidVersion}`,
        device.type,
      ]
        .join(' ')
        .toLowerCase()

      return text.indexOf(keyword) !== -1
    })
  }
  selectedDevices() {
    return filter(this.allDevices(), (device) =>
      this.selectedIds.includes(device.id)
    )
  }
  isSelected(id: string) {
    return this.selectedIds.includes(id)
  }
  toggleDeviceSelection(id: string) {
    if (this.isSelected(id)) {
      this.selectedIds = filter(
        this.selectedIds,
        (selectedId) => selectedId !== id
      )
    } else {
      this.selectedIds = concat(this.selectedIds, [id])
    }
    this.lastSelectedId = id
  }
  selectRangeTo(id: string) {
    const visible = map(this.visibleDevices(), (device) => device.id)
    const from = visible.indexOf(this.lastSelectedId)
    const to = visible.indexOf(id)
    if (from === -1 || to === -1) {
      this.toggleDeviceSelection(id)
      return
    }

    const start = Math.min(from, to)
    const end = Math.max(from, to)
    const selectedIds = this.selectedIds.slice()
    for (let i = start; i <= end; i++) {
      if (!selectedIds.includes(visible[i])) {
        selectedIds.push(visible[i])
      }
    }
    this.selectedIds = selectedIds
    this.lastSelectedId = id
  }
  selectAllDevices() {
    const visible = map(this.visibleDevices(), (device) => device.id)
    const allSelected =
      !isEmpty(visible) && visible.every((id) => this.isSelected(id))
    if (allSelected) {
      this.selectedIds = filter(this.selectedIds, (id) => !visible.includes(id))
    } else {
      this.selectedIds = unique(concat(this.selectedIds, visible))
    }
    this.lastSelectedId = ''
  }
  isAllSelected() {
    const visible = this.visibleDevices()
    return (
      !isEmpty(visible) && visible.every((device) => this.isSelected(device.id))
    )
  }
  clearSelection() {
    this.selectedIds = []
    this.lastSelectedId = ''
  }
  applyDiscoverUpdate(update: IDiscoverUpdate) {
    this.discover = update
    if (
      update.error &&
      !update.scanning &&
      update.connected === 0 &&
      update.error !== this.discoverErrorShown
    ) {
      this.discoverErrorShown = update.error
      notify(t('scanErr'), { icon: 'error' })
    }
    if (isEmpty(update.devices)) {
      return
    }

    const remoteDevices: IDevice[] = toJS(this.remoteDevices)
    let changed = false
    each(update.devices, (discovered) => {
      const hasSerial = discovered.serialno !== ''
      const remote = find(
        remoteDevices,
        (device) =>
          device.id === discovered.id ||
          (hasSerial && device.serialno === discovered.serialno)
      )
      const online = find(
        this.devices,
        (device) =>
          device.id === discovered.id ||
          (hasSerial && device.serialno === discovered.serialno)
      )

      if (discovered.state === 'connected') {
        if (online) {
          this.clearDeviceConnectState(discovered.id)
          return
        }
        const entry: IDevice = {
          id: discovered.id,
          name: discovered.name || discovered.id,
          serialno: discovered.serialno,
          androidVersion: discovered.androidVersion,
          sdkVersion: discovered.sdkVersion,
          type: 'device',
        }
        if (remote) {
          Object.assign(remote, entry)
        } else {
          remoteDevices.push(entry)
        }
        changed = true
        this.clearDeviceConnectState(discovered.id)
        return
      }

      // Not connected yet: keep it in the list as an unconnected entry so the
      // user can click it to connect.
      if (!remote && !online) {
        remoteDevices.push({
          id: discovered.id,
          name: discovered.name || discovered.host,
          serialno: discovered.serialno,
          androidVersion: discovered.androidVersion,
          sdkVersion: discovered.sdkVersion,
          type: 'offline',
        })
        changed = true
      }
      const alreadyOnline = !!online || (!!remote && remote.type === 'device')
      if (!alreadyOnline && !this.discoveredIds.includes(discovered.id)) {
        this.discoveredIds = concat(this.discoveredIds, [discovered.id])
      }
      if (
        !alreadyOnline &&
        discovered.state === 'failed' &&
        discovered.message
      ) {
        this.connectResults = {
          ...this.connectResults,
          [discovered.id]: { state: 'failed', message: discovered.message },
        }
      }
    })

    if (changed) {
      this.remoteDevices = remoteDevices
      main.setDevicesStore('remoteDevices', toJS(this.remoteDevices))
    }
  }
  isDiscovered(id: string) {
    return this.discoveredIds.includes(id)
  }
  isConnecting(id: string) {
    return this.connectingIds.includes(id)
  }
  async connectDeviceById(id: string, silent = false): Promise<boolean> {
    const device = find(this.allDevices(), (d) => d.id === id)
    if (
      !device ||
      !isRemoteDevice(id) ||
      isDeviceOnline(device) ||
      this.isConnecting(id)
    ) {
      return false
    }

    const [host, portStr] = id.split(':')
    const port = toNum(portStr) || 5555
    this.connectingIds = concat(this.connectingIds, [id])
    this.clearDeviceConnectState(id)

    try {
      const result = await main.connectDeviceChecked(host, port)
      if (result.state === 'device') {
        const remoteDevices: IDevice[] = toJS(this.remoteDevices)
        const updated: IDevice = {
          id,
          name: result.name || device.name || id,
          serialno: result.serialno || device.serialno,
          androidVersion: result.androidVersion || device.androidVersion,
          sdkVersion: result.sdkVersion || device.sdkVersion,
          type: 'device',
        }
        const idx = findIdx(
          remoteDevices,
          (item) =>
            item.id === id ||
            (!!device.serialno && item.serialno === device.serialno)
        )
        if (idx === -1) {
          remoteDevices.push(updated)
        } else {
          remoteDevices[idx] = updated
        }
        this.remoteDevices = remoteDevices
        main.setDevicesStore('remoteDevices', remoteDevices)
        if (!silent) {
          this.selectDevice(updated)
          main.sendToWindow('main', 'refreshDevices')
        }
        return true
      }

      this.connectResults = {
        ...this.connectResults,
        [id]: { state: result.state, message: result.message },
      }
      if (!silent) {
        notify(t('connectErr'), { icon: 'error' })
      }
      return false
    } catch (e) {
      this.connectResults = {
        ...this.connectResults,
        [id]: {
          state: 'failed',
          message: e instanceof Error ? e.message : String(e),
        },
      }
      if (!silent) {
        notify(t('connectErr'), { icon: 'error' })
      }
      return false
    } finally {
      this.connectingIds = filter(
        this.connectingIds,
        (connectingId) => connectingId !== id
      )
    }
  }
  async connectAddress(ip: string, port?: number): Promise<boolean> {
    const host = trim(ip)
    if (!host) {
      return false
    }
    const actualPort = port && port > 0 ? port : 5555
    const id = `${host}:${actualPort}`
    let device = find(this.allDevices(), (d) => d.id === id)
    if (!device) {
      const remoteDevices: IDevice[] = toJS(this.remoteDevices)
      const entry: IDevice = {
        id,
        name: host,
        serialno: '',
        androidVersion: '',
        sdkVersion: '',
        type: 'offline',
      }
      remoteDevices.push(entry)
      this.remoteDevices = remoteDevices
      main.setDevicesStore('remoteDevices', remoteDevices)
      device = entry
    }
    if (!this.discoveredIds.includes(id)) {
      this.discoveredIds = unique(concat(this.discoveredIds, [id]))
    }

    return this.connectDeviceById(id)
  }
  private clearDeviceConnectState(id: string) {
    if (this.discoveredIds.includes(id)) {
      this.discoveredIds = filter(
        this.discoveredIds,
        (discoveredId) => discoveredId !== id
      )
    }
    if (this.connectResults[id]) {
      const results = { ...this.connectResults }
      delete results[id]
      this.connectResults = results
    }
  }
  openBatch() {
    if (isEmpty(this.selectedIds) && this.device) {
      this.selectedIds = [this.device.id]
    }
    this.batchVisible = true
  }
  closeBatch() {
    this.batchVisible = false
  }
  setBatchType(type: BatchType) {
    if (this.batchRunning) {
      return
    }
    this.batchType = type
    this.batchSection = type
  }
  setBatchSection(section: BatchSection) {
    if (this.batchRunning || this.terminalRunning) {
      return
    }
    this.batchSection = section
    if (section !== 'terminal') {
      this.batchType = section
    }
  }
  setTerminalCommand(command: string) {
    this.terminalCommand = command
  }
  setTerminalPresets(presets: ITerminalPreset[]) {
    const cleaned = presets
      .map((preset) => ({
        id:
          preset.id ||
          `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        label: trim(preset.label),
        command: trim(preset.command),
      }))
      .filter((preset) => preset.label && preset.command)
    this.terminalPresets = cleaned
    main.setSettingsStore('terminalPresets', toJS(cleaned))
  }
  clearTerminalResults() {
    this.terminalResults = []
  }
  async runTerminal(command?: string) {
    if (this.terminalRunning) {
      return
    }
    const cmd = trim(command ?? this.terminalCommand)
    if (!cmd) {
      return
    }
    const devices = this.selectedDevices()
    if (isEmpty(devices)) {
      return
    }

    this.terminalRunning = true
    this.terminalResults = map(devices, (device) => ({
      deviceId: device.id,
      deviceName: device.name || device.id,
      command: cmd,
      status: 'pending',
      output: '',
      duration: 0,
    }))

    try {
      let index = 0
      const concurrency = Math.max(1, Math.min(this.batchConcurrency, 16))
      const worker = async () => {
        for (;;) {
          const i = index++
          if (i >= devices.length) {
            return
          }
          const device = devices[i]
          this.updateTerminalResult(device.id, { status: 'running' })
          const started = Date.now()
          try {
            if (!isDeviceOnline(device)) {
              const connected = await this.connectDeviceById(device.id, true)
              if (!connected) {
                throw new Error(t('deviceOffline'))
              }
            }
            const result = await main.runShellCommand(device.id, cmd, 20000)
            let output = `${result.stdout}${
              result.stderr ? `\n${result.stderr}` : ''
            }`.trim()
            if (result.timedOut) {
              output = `${output}\n[timeout]`.trim()
            }
            this.updateTerminalResult(device.id, {
              status:
                result.timedOut || result.code !== 0 ? 'failure' : 'success',
              output,
              duration: Date.now() - started,
            })
          } catch (e) {
            this.updateTerminalResult(device.id, {
              status: 'failure',
              output: e instanceof Error ? e.message : String(e),
              duration: Date.now() - started,
            })
          }
        }
      }

      await Promise.all(Array.from({ length: concurrency }, () => worker()))
    } finally {
      runInAction(() => {
        this.terminalRunning = false
      })
    }
  }
  private updateTerminalResult(
    deviceId: string,
    patch: Partial<ITerminalResult>
  ) {
    runInAction(() => {
      const idx = findIdx(
        this.terminalResults,
        (result) => result.deviceId === deviceId
      )
      if (idx !== -1) {
        this.terminalResults[idx] = { ...this.terminalResults[idx], ...patch }
      }
    })
  }
  addBatchApks(apkPaths: string[]) {
    this.batchApks = unique(concat(this.batchApks, apkPaths))
  }
  removeBatchApk(apkPath: string) {
    this.batchApks = filter(this.batchApks, (path) => path !== apkPath)
  }
  clearBatchApks() {
    this.batchApks = []
  }
  setBatchPackages(value: string) {
    this.batchPackages = value
  }
  setBatchConcurrency(value: number) {
    this.batchConcurrency = Math.max(1, Math.min(16, value || 1))
  }
  setBatchTimeout(value: number) {
    this.batchTimeout = Math.max(10, Math.min(3600, value || 10))
  }
  setBatchAllowSystemUninstall(value: boolean) {
    this.batchAllowSystemUninstall = value
  }
  setBatchSkipVerification(value: boolean) {
    this.batchSkipVerification = value
  }
  setBatchActiveKey(key: string) {
    this.batchActiveKey = key
  }
  parsePackages() {
    const seen = new Set<string>()
    const packages: string[] = []
    each(this.batchPackages.split(/\r?\n/), (line) => {
      line = trim(line)
      if (!line || !PACKAGE_REG.test(line) || seen.has(line)) {
        return
      }
      seen.add(line)
      packages.push(line)
    })

    return packages
  }
  invalidPackageCount() {
    let count = 0
    each(this.batchPackages.split(/\r?\n/), (line) => {
      line = trim(line)
      if (line && !PACKAGE_REG.test(line)) {
        count++
      }
    })

    return count
  }
  getTasks(): IBatchTask[] {
    if (this.batchType === 'install') {
      return map(this.batchApks, (apkPath) => ({
        id: apkPath,
        label: apkPath.split(/[\\/]/).pop() || apkPath,
        action: 'install' as PackageAction,
      }))
    }

    return map(this.parsePackages(), (pkg) => ({
      id: pkg,
      label: pkg,
      action: 'uninstall' as PackageAction,
    }))
  }
  async preflight(): Promise<IBatchPreflight> {
    const devices = this.selectedDevices()
    const tasks = this.getTasks()

    // Offline devices may just have a stale adb transport; reconnect them before
    // preflight so system-app detection sees the real device state.
    await Promise.all(
      map(devices, async (device) => {
        if (!isDeviceOnline(device)) {
          await this.connectDeviceById(device.id, true)
        }
      })
    )

    const online = filter(this.selectedDevices(), (device) =>
      isDeviceOnline(device)
    )
    const states: Record<string, Record<string, PackageState>> = {}

    await Promise.all(
      map(online, async (device) => {
        try {
          states[device.id] = await withTimeout(
            main.getPackageStates(
              device.id,
              map(tasks, (task) => task.id)
            ),
            PREFLIGHT_TIMEOUT,
            {}
          )
        } catch {
          states[device.id] = {}
        }
      })
    )

    this.packageStates = states

    let system = 0
    let missing = 0
    each(tasks, (task) => {
      const statesOfTask = map(
        online,
        (device) => states[device.id] && states[device.id][task.id]
      )
      if (statesOfTask.includes('system')) {
        system++
      }
      if (
        !isEmpty(statesOfTask) &&
        statesOfTask.every((s) => s === 'missing')
      ) {
        missing++
      }
    })

    const result = {
      devices: devices.length,
      tasks: tasks.length,
      system,
      missing,
    }
    runInAction(() => {
      this.batchPreflight = result
    })

    return result
  }
  async runBatch(preflightDone = false) {
    if (this.batchRunning) {
      return
    }
    const devices = this.selectedDevices()
    const tasks = this.getTasks()
    if (isEmpty(devices) || isEmpty(tasks)) {
      return
    }

    runInAction(() => {
      this.batchRunning = true
      this.batchCells = []
      this.batchActiveKey = ''
      this.batchProgress = { done: 0, total: devices.length * tasks.length }
    })

    const verifyOriginals: Record<string, string> = {}

    try {
      if (this.batchType === 'install' && this.batchSkipVerification) {
        await Promise.all(
          map(devices, async (device) => {
            if (!isDeviceOnline(device)) {
              return
            }
            try {
              verifyOriginals[device.id] = await main.beginInstallVerification(
                device.id
              )
            } catch {
              // Ignore, the install will use the normal verification path.
            }
          })
        )
      }

      if (this.batchType === 'uninstall') {
        if (!preflightDone) {
          await this.preflight()
        }
      } else {
        this.packageStates = {}
      }

      const cells: IBatchCell[] = []
      each(devices, (device) => {
        each(tasks, (task) => {
          let action = task.action
          let status: BatchCellStatus = 'pending'
          let message = ''
          if (task.action === 'uninstall') {
            const deviceStates = this.packageStates[device.id]
            const state = deviceStates ? deviceStates[task.id] : undefined
            if (state === 'missing') {
              status = 'skipped'
              message = t('packageNotInstalled')
            } else if (state === 'system') {
              action = this.batchAllowSystemUninstall ? 'uninstall' : 'disable'
            }
          }

          cells.push({
            key: `${device.id}\u001f${task.id}`,
            deviceId: device.id,
            deviceName: device.name || device.id,
            taskId: task.id,
            taskLabel: task.label,
            action,
            status,
            message,
            output: '',
            duration: 0,
          })
        })
      })

      runInAction(() => {
        this.batchCells = cells
        this.batchProgress = {
          done: cells.filter((cell) => this.isCellDone(cell)).length,
          total: cells.length,
        }
      })

      const queue = filter(cells, (cell) => cell.status === 'pending')
      let index = 0
      const concurrency = Math.max(1, Math.min(this.batchConcurrency, 16))
      const worker = async () => {
        for (;;) {
          const i = index++
          if (i >= queue.length) {
            return
          }
          await this.runCell(queue[i])
        }
      }

      await Promise.all(Array.from({ length: concurrency }, () => worker()))
    } finally {
      const restoreIds = Object.keys(verifyOriginals)
      let restoreFailed = false
      if (!isEmpty(restoreIds)) {
        await Promise.all(
          map(restoreIds, async (deviceId) => {
            try {
              await main.endInstallVerification(
                deviceId,
                verifyOriginals[deviceId]
              )
            } catch {
              restoreFailed = true
            }
          })
        )
      }
      if (restoreFailed) {
        notify(t('batchVerifyRestoreErr'), { icon: 'error' })
      }
      runInAction(() => {
        this.batchRunning = false
      })
      main.sendToWindow('main', 'refreshDevices')
    }
  }
  private isCellDone(cell: IBatchCell) {
    return (
      cell.status === 'success' ||
      cell.status === 'failure' ||
      cell.status === 'skipped'
    )
  }
  private async runCell(cell: IBatchCell) {
    const device = find(this.allDevices(), (d) => d.id === cell.deviceId)
    if (!device) {
      this.updateCell(cell.key, {
        status: 'failure',
        message: t('deviceOffline'),
      })
      return
    }
    if (!isDeviceOnline(device)) {
      const connected = await this.connectDeviceById(cell.deviceId, true)
      if (!connected) {
        this.updateCell(cell.key, {
          status: 'failure',
          message: t('deviceOffline'),
        })
        return
      }
    }

    this.updateCell(cell.key, { status: 'running', message: '' })
    const started = Date.now()
    try {
      let result = await this.invokeTask(cell)
      if (result.status === 'failure' && this.isTransportFailure(result)) {
        // The device may have rebooted or dropped its adb transport during the
        // task. Reconnect once and retry, which recovers most flaky TV boxes.
        const reconnected = await this.connectDeviceById(cell.deviceId, true)
        if (reconnected) {
          result = await this.invokeTask(cell)
        }
      }
      this.updateCell(cell.key, {
        status: result.status,
        message: result.message,
        output: result.output,
        duration: result.duration,
      })
    } catch (e) {
      this.updateCell(cell.key, {
        status: 'failure',
        message: e instanceof Error ? e.message : String(e),
        duration: Date.now() - started,
      })
    }
  }
  private isTransportFailure(result: IPackageTaskResult) {
    const text = `${result.message}\n${result.output}`.toLowerCase()

    return /waiting for device|device offline|device went offline|device ['"][^'"]+['"] not found|device not found|protocol fault|connection reset|connection closed/.test(
      text
    )
  }
  private invokeTask(cell: IBatchCell): Promise<IPackageTaskResult> {
    const timeout = Math.max(0, this.batchTimeout) * 1000
    const call = main.runPackageTask({
      deviceId: cell.deviceId,
      action: cell.action,
      target: cell.taskId,
      timeout,
    })
    if (timeout <= 0) {
      return call
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(t('batchTimeoutErr')))
      }, timeout + 15000)
      call.then(
        (result) => {
          clearTimeout(timer)
          resolve(result)
        },
        (err) => {
          clearTimeout(timer)
          reject(err)
        }
      )
    })
  }
  private updateCell(key: string, patch: Partial<IBatchCell>) {
    runInAction(() => {
      const idx = findIdx(this.batchCells, (cell) => cell.key === key)
      if (idx === -1) {
        return
      }
      this.batchCells[idx] = { ...this.batchCells[idx], ...patch }
      this.batchProgress = {
        done: this.batchCells.filter((cell) => this.isCellDone(cell)).length,
        total: this.batchCells.length,
      }
    })
  }
  private bindEvent() {
    main.on('changeMemStore', (name, val) => {
      switch (name) {
        case 'devices':
          this.updateDevices(val)
          break
      }
    })
    main.on('discoverUpdate', (update: IDiscoverUpdate) => {
      this.applyDiscoverUpdate(update)
    })
  }
}

export default new Store()
