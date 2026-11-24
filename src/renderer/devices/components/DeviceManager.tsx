import LunaDataGrid from 'luna-data-grid/react'
import { observer } from 'mobx-react-lite'
import Style from './DeviceManager.module.scss'
import { t } from 'common/util'
import map from 'licia/map'
import concat from 'licia/concat'
import toEl from 'licia/toEl'
import store from '../store'
import { useRef } from 'react'
import DataGrid from 'luna-data-grid'
import { useResizeSensor } from 'share/renderer/lib/hooks'
import { isDeviceOnline } from '../lib/util'

export default observer(function DeviceManager() {
  const containerRef = useRef<HTMLDivElement>(null)
  const dataGridRef = useRef<DataGrid>(null)

  useResizeSensor(containerRef, () => {
    dataGridRef.current?.fit()
  })

  const devices = map(concat(store.devices, store.remoteDevices), (device) => {
    const online = isDeviceOnline(device)
    const connecting = store.isConnecting(device.id)
    const result = store.connectResults[device.id]
    const discovered = store.isDiscovered(device.id)
    const checkbox = toEl(
      `<input type="checkbox" class="${Style.checkbox}" />`
    ) as HTMLInputElement
    checkbox.checked = store.isSelected(device.id)
    checkbox.addEventListener('click', (e) => {
      e.stopPropagation()
      store.toggleDeviceSelection(device.id)
    })

    let statusText = t('offline')
    let statusClass = Style.offline
    if (connecting) {
      statusText = t('connectingDevice')
      statusClass = Style.connecting
    } else if (online) {
      statusText = t('online')
      statusClass = Style.online
    } else if (result && result.state === 'unauthorized') {
      statusText = t('deviceUnauthorized')
      statusClass = Style.failed
    } else if (result) {
      statusText = t('connectFailed')
      statusClass = Style.failed
    } else if (discovered) {
      statusText = t('notConnected')
      statusClass = Style.notConnected
    }
    const status = toEl(`<span class="${statusClass}"></span>`)
    status.textContent = statusText
    const statusTitle = online ? '' : result ? result.message : t('connectTip')
    if (statusTitle) {
      status.setAttribute('title', statusTitle)
    }

    return {
      selected: checkbox,
      id: device.id,
      name: device.name,
      serialno: device.serialno,
      androidVersion: `Android ${device.androidVersion} (API ${device.sdkVersion})`,
      status,
      type: device.type,
    }
  })

  return (
    <div ref={containerRef} className={Style.container}>
      <LunaDataGrid
        className={Style.devices}
        onSelect={(node: any) => {
          const id = node.data.id as string
          store.selectDevice(id)
          const device = store.allDevices().find((item) => item.id === id)
          if (device && !isDeviceOnline(device)) {
            void store.connectDeviceById(id)
          }
        }}
        onDeselect={() => store.selectDevice(null)}
        onClick={(e, node: any) => {
          const id = node.data.id as string
          if (e.metaKey || e.ctrlKey) {
            store.toggleDeviceSelection(id)
          } else if (e.shiftKey) {
            store.selectRangeTo(id)
          }
        }}
        columns={columns}
        data={devices}
        selectable={true}
        filter={store.filter}
        onDoubleClick={(e, node: any) => {
          if (node.data.type !== 'offline') {
            main.sendToWindow('main', 'selectDevice', node.data.id)
          }
        }}
        uniqueId="id"
        onCreate={(dataGrid) => {
          dataGridRef.current = dataGrid
          dataGrid.fit()
        }}
      />
    </div>
  )
})

const columns = [
  {
    id: 'selected',
    title: '',
    sortable: false,
    weight: 4,
  },
  {
    id: 'id',
    title: 'ID',
    sortable: true,
    weight: 15,
  },
  {
    id: 'serialno',
    title: t('serialno'),
    sortable: true,
    weight: 15,
  },
  {
    id: 'name',
    title: t('name'),
    sortable: true,
    weight: 28,
  },
  {
    id: 'androidVersion',
    title: t('androidVersion'),
    sortable: true,
    weight: 28,
  },
  {
    id: 'status',
    title: t('status'),
    sortable: true,
    weight: 10,
  },
]
