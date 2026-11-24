import dateFormat from 'licia/dateFormat'
import { t } from 'common/util'
import type { BatchCellStatus, BatchType, IBatchCell } from '../store'

export interface IBatchDeviceColumn {
  id: string
  name: string
}

export interface IBatchTaskColumn {
  id: string
  label: string
}

export function statusText(status: BatchCellStatus) {
  switch (status) {
    case 'running':
      return t('batchRunningStatus')
    case 'success':
      return t('batchSuccess')
    case 'failure':
      return t('batchFailure')
    case 'skipped':
      return t('batchSkipped')
    default:
      return t('batchPending')
  }
}

export function sumCells(cells: IBatchCell[]) {
  const summary = {
    pending: 0,
    running: 0,
    success: 0,
    failure: 0,
    skipped: 0,
  }
  cells.forEach((cell) => {
    summary[cell.status]++
  })

  return summary
}

export function getBatchMatrix(cells: IBatchCell[]) {
  const devices: IBatchDeviceColumn[] = []
  const tasks: IBatchTaskColumn[] = []
  const deviceSeen = new Set<string>()
  const taskSeen = new Set<string>()

  cells.forEach((cell) => {
    if (!deviceSeen.has(cell.deviceId)) {
      deviceSeen.add(cell.deviceId)
      devices.push({ id: cell.deviceId, name: cell.deviceName })
    }
    if (!taskSeen.has(cell.taskId)) {
      taskSeen.add(cell.taskId)
      tasks.push({ id: cell.taskId, label: cell.taskLabel })
    }
  })

  const cellMap = new Map<string, IBatchCell>()
  cells.forEach((cell) => {
    cellMap.set(cell.key, cell)
  })

  return {
    devices,
    tasks,
    getCell(deviceId: string, taskId: string) {
      return cellMap.get(`${deviceId}\u001f${taskId}`)
    },
  }
}

export function buildBatchLog(cells: IBatchCell[], type: BatchType) {
  const summary = sumCells(cells)
  const lines: string[] = []

  lines.push(`# AYA batch ${type} log`)
  lines.push(`# ${dateFormat(new Date(), 'yyyy-mm-dd HH:MM:ss')}`)
  lines.push(
    `# total ${cells.length}, success ${summary.success}, failure ${summary.failure}, skipped ${summary.skipped}`
  )

  cells.forEach((cell) => {
    lines.push('')
    lines.push(
      `[${cell.deviceId}] ${cell.taskLabel} (${cell.action}) -> ${cell.status}` +
        ` ${cell.duration}ms${cell.message ? ` | ${cell.message}` : ''}`
    )
    if (cell.output) {
      lines.push('----- adb output -----')
      lines.push(cell.output)
    }
  })

  return lines.join('\n')
}

export function buildCellLog(cell: IBatchCell) {
  return [
    `[${cell.deviceId}] ${cell.taskLabel} (${cell.action}) -> ${cell.status}`,
    `duration: ${cell.duration}ms`,
    cell.message ? `message: ${cell.message}` : '',
    cell.output ? `----- adb output -----\n${cell.output}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export async function copyLog(text: string) {
  await navigator.clipboard.writeText(text)
}

export async function exportLog(text: string) {
  const { canceled, filePath } = await main.showSaveDialog({
    defaultPath: `aya-batch-${dateFormat(new Date(), 'yyyymmdd-HHMMss')}.log`,
    filters: [{ name: 'log file', extensions: ['log', 'txt'] }],
  })
  if (canceled || !filePath) {
    return ''
  }

  await node.writeFile(filePath, text)

  return filePath
}
