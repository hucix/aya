import { t } from 'common/util'

export interface ITerminalPreset {
  id: string
  label: string
  command: string
}

export function defaultTerminalPresets(): ITerminalPreset[] {
  return [
    {
      id: 'default-info',
      label: t('terminalPresetInfo'),
      command:
        'getprop ro.product.model; getprop ro.build.version.release; getprop ro.serialno',
    },
    {
      id: 'default-apps',
      label: t('terminalPresetApps'),
      command: 'pm list packages -3',
    },
    {
      id: 'default-battery',
      label: t('terminalPresetBattery'),
      command: 'dumpsys battery',
    },
    {
      id: 'default-storage',
      label: t('terminalPresetStorage'),
      command: 'df -h /data',
    },
    {
      id: 'default-network',
      label: t('terminalPresetNetwork'),
      command: 'ip addr show wlan0',
    },
  ]
}
