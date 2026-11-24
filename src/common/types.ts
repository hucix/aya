export interface IDevice {
  id: string
  name: string
  serialno: string
  androidVersion: string
  sdkVersion: string
  type: 'emulator' | 'device' | 'offline' | 'unauthorized' | 'unknown'
}

export interface IAvd {
  id: string
  name: string
  abi: string
  sdkVersion: string
  memory: number
  internalStorage: number
  resolution: string
  folder: string
  pid: number
}

export interface IPackageInfo {
  icon: string
  label: string
  enabled: boolean
  packageName: string
  versionName: string
  apkPath: string
  apkSize: number
  system: boolean
  firstInstallTime: number
  lastUpdateTime: number
  minSdkVersion?: number
  targetSdkVersion?: number
  dataSize: number
  cacheSize: number
  appSize: number
  signatures: string[]
}

export interface IFileStat {
  size?: number
  mtime: Date
  directory: boolean
  mode: string
}

export interface IFile extends IFileStat {
  name: string
  mime?: string
}

export interface IWebview {
  title: string
  url: string
  devtoolsFrontendUrl: string
  webSocketDebuggerUrl: string
  faviconUrl?: string
}

export interface IProcess {
  name: string
  pid: string
}

export enum TransferType {
  Upload,
  Download,
}

export type IpcGetFps = (deviceId: string, pkg: string) => Promise<number>
export type IpcGetDevices = () => Promise<IDevice[]>
export type IpcSetScreencastAlwaysOnTop = (alwaysOnTop: boolean) => void
export type IpcListForwards = (
  deviceId: string
) => Promise<Array<{ local: string; remote: string }>>
export type IpcListReverses = IpcListForwards
export type IpcForward = (
  deviceId: string,
  local: string,
  remote: string
) => void
export type IpcReverse = (
  deviceId: string,
  remote: string,
  local: string
) => void
export type IpcDumpWindowHierarchy = (deviceId: string) => Promise<string>
export type IpcGetPackageInfos = (
  deviceId: string,
  packageNames: string[]
) => Promise<IPackageInfo[]>
export type IpcGetAvds = (forceRefresh?: boolean) => Promise<IAvd[]>
export type IpcStartAvd = (avdId: string) => Promise<void>
export type IpcStopAvd = IpcStartAvd
export type IpcWipeAvdData = (avdId: string) => Promise<void>
export type IpcPairDevice = (
  host: string,
  port: number,
  password: string
) => Promise<void>
export type IpcCreateShell = (deviceId: string) => Promise<string>
export type IpcWriteShell = (sessionId: string, data: string) => void
export type IpcResizeShell = (
  sessionId: string,
  cols: number,
  rows: number
) => void
export type IpcKillShell = (sessionId: string) => void
export type IpcScreencap = (deviceId: string) => Promise<string>
export type IpcOpenLogcat = (deviceId: string) => Promise<string>
export type IpcCloseLogcat = (logcatId: string) => Promise<void>
export type IpcPauseLogcat = IpcCloseLogcat
export type IpcResumeLogcat = IpcCloseLogcat
export type IpcInputKey = (deviceId: string, keyCode: number) => Promise<void>
export type IpcReverseTcp = (
  deviceId: string,
  remote: string
) => Promise<number>
export type IpcStartScrcpy = (deviceId: string, args: string[]) => Promise<void>
export type IpcConnectDevice = (host: string, port?: number) => Promise<void>
export type IpcDisconnectDevice = IpcConnectDevice
export type IpcMoveFile = (
  deviceId: string,
  src: string,
  dest: string
) => Promise<void>
export type IpcStatFile = (deviceId: string, path: string) => Promise<IFileStat>
export type IpcReadDir = (deviceId: string, path: string) => Promise<IFile[]>
export type IpcCreateDir = (deviceId: string, path: string) => Promise<void>
export type IpcDeleteDir = IpcCreateDir
export type IpcDeleteFile = IpcCreateDir
export type IpcOpenFile = IpcCreateDir
export type IpcPushFile = (
  deviceId: string,
  src: string,
  dest: string
) => Promise<void>
export type IpcPullFile = (
  deviceId: string,
  src: string,
  dest: string
) => Promise<void>
export type IpcEnablePackage = (deviceId: string, pkg: string) => Promise<void>
export type IpcDisablePackage = IpcEnablePackage
export type IpcGetPackages = (
  deviceId: string,
  system?: boolean
) => Promise<string[]>
export type IpcInstallPackage = (
  deviceId: string,
  apkPath: string
) => Promise<void>
export type IpcUninstallPackage = (
  deviceId: string,
  pkg: string
) => Promise<void>
export type IpcStartPackage = (deviceId: string, pkg: string) => Promise<void>
export type IpcStopPackage = IpcStartPackage
export type IpcClearPackage = IpcStartPackage
export type IpcGetTopPackage = (deviceId: string) => Promise<{
  name: string
  pid: number
}>
export type IpcGetWebviews = (
  deviceId: string,
  pid: number
) => Promise<IWebview[]>
export type IpcGetProcesses = (deviceId: string) => Promise<IProcess[]>
export type IpcGetFileUrl = (
  deviceId: string,
  path: string,
  port?: number
) => Promise<string>

export type PackageAction = 'install' | 'uninstall' | 'disable'
export type PackageTaskStatus = 'success' | 'failure' | 'skipped'
export type PackageState = 'system' | 'user' | 'missing'

export interface IPackageTask {
  deviceId: string
  action: PackageAction
  target: string
  timeout?: number
}

export interface IPackageTaskResult {
  deviceId: string
  action: PackageAction
  target: string
  status: PackageTaskStatus
  message: string
  output: string
  duration: number
}

export type IpcRunPackageTask = (
  task: IPackageTask
) => Promise<IPackageTaskResult>

export type IpcGetPackageStates = (
  deviceId: string,
  packages: string[]
) => Promise<Record<string, PackageState>>

export type DiscoverSource = 'mdns' | 'scan'
export type DiscoverState = 'found' | 'connecting' | 'connected' | 'failed'

export interface IDiscoveredDevice {
  id: string
  host: string
  port: number
  name: string
  serialno: string
  androidVersion: string
  sdkVersion: string
  type: IDevice['type']
  source: DiscoverSource
  state: DiscoverState
  message: string
}

export interface IDiscoverUpdate {
  scanning: boolean
  scanned: number
  total: number
  connected: number
  failed: number
  devices: IDiscoveredDevice[]
  error?: string
}

export type IpcStartDiscover = (options?: {
  concurrency?: number
  timeout?: number
}) => Promise<void>

export type IpcStopDiscover = () => Promise<void>

export type IpcGetDiscoverState = () => Promise<IDiscoverUpdate>

export type DeviceConnectState =
  | 'device'
  | 'offline'
  | 'unauthorized'
  | 'failed'

export interface IConnectDeviceResult {
  state: DeviceConnectState
  serialno: string
  name: string
  androidVersion: string
  sdkVersion: string
  message: string
}

export type IpcConnectDeviceChecked = (
  host: string,
  port?: number
) => Promise<IConnectDeviceResult>

export type IpcBeginInstallVerification = (deviceId: string) => Promise<string>

export type IpcEndInstallVerification = (
  deviceId: string,
  original: string
) => Promise<void>

export interface IShellCommandResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

export type IpcRunShellCommand = (
  deviceId: string,
  command: string,
  timeout?: number
) => Promise<IShellCommandResult>

export type IpcForwardPort = (
  deviceId: string,
  remote: string
) => Promise<number>

export interface IMinicapInfo {
  width: number
  height: number
}

export type IpcStartMinicap = (deviceId: string) => Promise<IMinicapInfo>

export type IpcStopMinicap = (deviceId: string) => Promise<void>
