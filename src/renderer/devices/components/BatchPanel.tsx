import { observer } from 'mobx-react-lite'
import { useState } from 'react'
import { t } from 'common/util'
import LunaModal from 'luna-modal'
import find from 'licia/find'
import map from 'licia/map'
import filter from 'licia/filter'
import isEmpty from 'licia/isEmpty'
import className from 'licia/className'
import toNum from 'licia/toNum'
import trim from 'licia/trim'
import store from '../store'
import Style from './BatchPanel.module.scss'
import { notify } from 'share/renderer/lib/util'
import { isDeviceOnline } from '../lib/util'
import {
  buildBatchLog,
  buildCellLog,
  copyLog,
  exportLog,
  getBatchMatrix,
  statusText,
  sumCells,
} from '../lib/batch'
import { ITerminalPreset, defaultTerminalPresets } from '../lib/terminal'

function terminalStatusText(status: string) {
  switch (status) {
    case 'running':
      return t('batchRunningStatus')
    case 'success':
      return t('batchSuccess')
    case 'failure':
      return t('batchFailure')
    default:
      return t('batchPending')
  }
}

export default observer(function BatchPanel() {
  const [preflighting, setPreflighting] = useState(false)
  const [presetsVisible, setPresetsVisible] = useState(false)
  const [draftPresets, setDraftPresets] = useState<ITerminalPreset[]>([])
  const allDevices = store.allDevices()
  const devices = store.selectedDevices()
  const tasks = store.getTasks()
  const cells = store.batchCells
  const matrix = getBatchMatrix(cells)
  const activeCell = find(cells, (cell) => cell.key === store.batchActiveKey)
  const summary = sumCells(cells)
  const onlineCount = filter(devices, (device) => isDeviceOnline(device)).length
  const startDisabled =
    store.batchRunning || preflighting || isEmpty(devices) || isEmpty(tasks)

  function actionText(action: string) {
    if (action === 'install') {
      return t('install')
    }
    if (action === 'disable') {
      return t('disablePackage')
    }

    return t('uninstall')
  }

  async function chooseApks() {
    try {
      const { filePaths } = await main.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'apk file', extensions: ['apk'] }],
      })
      if (!isEmpty(filePaths)) {
        store.addBatchApks(filePaths)
      }
    } catch {
      notify(t('commonErr'), { icon: 'error' })
    }
  }

  async function start() {
    if (startDisabled) {
      return
    }
    if (isEmpty(devices)) {
      notify(t('batchNoSelection'), { icon: 'error' })
      return
    }
    if (isEmpty(tasks)) {
      notify(t('batchNoTask'), { icon: 'error' })
      return
    }

    let preflightDone = false
    if (store.batchType === 'uninstall') {
      let preflight
      setPreflighting(true)
      try {
        preflight = await store.preflight()
      } catch {
        notify(t('commonErr'), { icon: 'error' })
        return
      } finally {
        setPreflighting(false)
      }

      let message = t('batchUninstallConfirm', {
        devices: devices.length,
        packages: tasks.length,
      })
      if (preflight.system > 0) {
        message += ` ${t('batchUninstallSysTip', {
          count: preflight.system,
        })}`
        message += ` ${
          store.batchAllowSystemUninstall
            ? t('batchUninstallForceTip')
            : t('batchUninstallDisableTip')
        }`
      }
      if (preflight.missing > 0) {
        message += ` ${t('batchUninstallMissingTip', {
          count: preflight.missing,
        })}`
      }

      const ok = await LunaModal.confirm(message)
      if (!ok) {
        return
      }
      preflightDone = true
    }

    await store.runBatch(preflightDone)
  }

  function openPresetManager() {
    setDraftPresets(map(store.terminalPresets, (preset) => ({ ...preset })))
    setPresetsVisible(true)
  }

  function updateDraftPreset(
    index: number,
    name: 'label' | 'command',
    value: string
  ) {
    setDraftPresets(
      map(draftPresets, (preset, i) =>
        i === index ? { ...preset, [name]: value } : preset
      )
    )
  }

  function addDraftPreset() {
    setDraftPresets([
      ...draftPresets,
      {
        id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        label: '',
        command: '',
      },
    ])
  }

  function removeDraftPreset(index: number) {
    setDraftPresets(draftPresets.filter((_, i) => i !== index))
  }

  function resetDraftPresets() {
    setDraftPresets(defaultTerminalPresets())
  }

  function savePresetManager() {
    const cleaned = draftPresets
      .map((preset) => ({
        ...preset,
        label: trim(preset.label),
        command: trim(preset.command),
      }))
      .filter((preset) => preset.label && preset.command)
    if (isEmpty(cleaned)) {
      notify(t('terminalPresetEmpty'), { icon: 'error' })
      return
    }
    store.setTerminalPresets(cleaned)
    setPresetsVisible(false)
    notify(t('terminalPresetSaved'), { icon: 'success' })
  }

  function terminalLog() {
    return map(
      store.terminalResults,
      (result) => `[${result.deviceId}] ${result.command}\n${result.output}`
    ).join('\n\n')
  }

  async function copyAll() {
    if (isEmpty(cells) && isEmpty(store.terminalResults)) {
      return
    }
    try {
      await copyLog(
        store.batchSection === 'terminal'
          ? terminalLog()
          : buildBatchLog(cells, store.batchType)
      )
      notify(t('batchCopied'), { icon: 'success' })
    } catch {
      notify(t('commonErr'), { icon: 'error' })
    }
  }

  async function exportAll() {
    if (isEmpty(cells) && isEmpty(store.terminalResults)) {
      return
    }
    try {
      const path = await exportLog(
        store.batchSection === 'terminal'
          ? terminalLog()
          : buildBatchLog(cells, store.batchType)
      )
      if (path) {
        notify(t('batchExported', { path }), {
          icon: 'success',
          duration: 5000,
        })
      }
    } catch {
      notify(t('commonErr'), { icon: 'error' })
    }
  }

  async function copyCell() {
    if (!activeCell) {
      return
    }
    try {
      await copyLog(buildCellLog(activeCell))
      notify(t('batchCopied'), { icon: 'success' })
    } catch {
      notify(t('commonErr'), { icon: 'error' })
    }
  }

  const progress = isEmpty(cells)
    ? 0
    : Math.round((store.batchProgress.done / store.batchProgress.total) * 100)

  return (
    <div className={Style.panel}>
      <div className={Style.header}>
        <span className={Style.title}>{t('batchOperation')}</span>
        <span className={Style.headerTip}>
          {t('batchSelectedSummary', {
            devices: devices.length,
            online: onlineCount,
          })}
        </span>
        <span className={Style.spacer} />
      </div>

      <div className={Style.columns}>
        <div className={Style.deviceColumn}>
          <div className={Style.sectionHeader}>
            <span>{t('batchSelectedDevices')}</span>
            <span className={Style.spacer} />
            <button
              className={className('button', Style.smallButton)}
              onClick={() => store.selectAllDevices()}
            >
              {store.isAllSelected() ? t('unselectAll') : t('selectAll')}
            </button>
            <button
              className={className('button', Style.smallButton)}
              onClick={() => store.clearSelection()}
              disabled={isEmpty(devices)}
            >
              {t('batchClearSelection')}
            </button>
          </div>
          <div className={Style.deviceList}>
            {isEmpty(allDevices) ? (
              <div className={Style.empty}>{t('batchNoSelection')}</div>
            ) : (
              map(allDevices, (device) => {
                const online = isDeviceOnline(device)
                const connecting = store.isConnecting(device.id)
                const result = store.connectResults[device.id]
                const discovered = store.isDiscovered(device.id)
                let stateText = t('offline')
                if (connecting) {
                  stateText = t('connectingDevice')
                } else if (online) {
                  stateText = t('online')
                } else if (result && result.state === 'unauthorized') {
                  stateText = t('deviceUnauthorized')
                } else if (result) {
                  stateText = t('connectFailed')
                } else if (discovered) {
                  stateText = t('notConnected')
                }

                return (
                  <label className={Style.deviceRow} key={device.id}>
                    <input
                      type="checkbox"
                      checked={store.isSelected(device.id)}
                      onChange={() => store.toggleDeviceSelection(device.id)}
                    />
                    <span className={Style.deviceInfo}>
                      <span className={Style.deviceName}>
                        {device.name || device.id}
                      </span>
                      <span className={Style.deviceId}>{device.id}</span>
                    </span>
                    <span
                      className={className(Style.deviceState, {
                        [Style.stateOnline]: online,
                        [Style.stateConnecting]: connecting,
                        [Style.stateFailed]: !!result && !online,
                        [Style.stateOffline]: !online && !connecting && !result,
                      })}
                      title={result ? result.message : ''}
                    >
                      {stateText}
                    </span>
                  </label>
                )
              })
            )}
          </div>
        </div>

        <div className={Style.taskColumn}>
          <div className={Style.sectionHeader}>
            <div className={Style.tabs}>
              <button
                className={className(Style.tab, {
                  [Style.tabActive]: store.batchSection === 'install',
                })}
                onClick={() => store.setBatchSection('install')}
              >
                {t('install')}
              </button>
              <button
                className={className(Style.tab, {
                  [Style.tabActive]: store.batchSection === 'uninstall',
                })}
                onClick={() => store.setBatchSection('uninstall')}
              >
                {t('uninstall')}
              </button>
              <button
                className={className(Style.tab, {
                  [Style.tabActive]: store.batchSection === 'terminal',
                })}
                onClick={() => store.setBatchSection('terminal')}
              >
                {t('batchTerminal')}
              </button>
            </div>
            <span className={Style.spacer} />
            <span className={Style.taskCount}>
              {store.batchSection === 'terminal'
                ? t('terminalDeviceCount', { count: devices.length })
                : t('batchTaskCount', { count: tasks.length })}
            </span>
          </div>

          {store.batchSection === 'terminal' ? (
            <div className={Style.taskBody}>
              <div className={Style.terminalPresets}>
                {map(store.terminalPresets, (preset) => (
                  <button
                    key={preset.id}
                    className={Style.terminalPreset}
                    title={preset.command}
                    onClick={() => {
                      store.setTerminalCommand(preset.command)
                      store.runTerminal(preset.command)
                    }}
                    disabled={store.terminalRunning}
                  >
                    {preset.label}
                  </button>
                ))}
                <button
                  className={className(
                    Style.terminalPreset,
                    Style.terminalMore
                  )}
                  onClick={openPresetManager}
                  disabled={store.terminalRunning}
                >
                  {t('terminalMore')}
                </button>
              </div>
              <div className={Style.terminalInputRow}>
                <input
                  className={Style.terminalInput}
                  value={store.terminalCommand}
                  placeholder={t('terminalPlaceholder')}
                  onChange={(e) => store.setTerminalCommand(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      store.runTerminal()
                    }
                  }}
                />
                <button
                  className={className('button', 'primary', Style.smallButton)}
                  disabled={
                    store.terminalRunning ||
                    isEmpty(trim(store.terminalCommand))
                  }
                  onClick={() => store.runTerminal()}
                >
                  {t('terminalSend')}
                </button>
                <button
                  className={className('button', Style.smallButton)}
                  onClick={() => store.clearTerminalResults()}
                  disabled={
                    store.terminalRunning || isEmpty(store.terminalResults)
                  }
                >
                  {t('clear')}
                </button>
              </div>
              <div className={Style.systemTip}>{t('terminalTip')}</div>
              {store.terminalRunning ? (
                <div className={Style.taskCount}>{t('terminalRunning')}</div>
              ) : null}
            </div>
          ) : store.batchType === 'install' ? (
            <div className={Style.taskBody}>
              <div className={Style.taskActions}>
                <button
                  className={className('button', 'primary', Style.smallButton)}
                  onClick={chooseApks}
                >
                  {t('batchSelectApk')}
                </button>
                <button
                  className={className('button', Style.smallButton)}
                  onClick={() => store.clearBatchApks()}
                  disabled={isEmpty(store.batchApks)}
                >
                  {t('clear')}
                </button>
              </div>
              <div className={Style.apkList}>
                {isEmpty(store.batchApks) ? (
                  <div className={Style.empty}>{t('batchNoApk')}</div>
                ) : (
                  map(store.batchApks, (apkPath) => (
                    <div className={Style.apkRow} key={apkPath}>
                      <span className={Style.apkName} title={apkPath}>
                        {apkPath.split(/[\\/]/).pop() || apkPath}
                      </span>
                      <button
                        className={Style.removeButton}
                        title={t('delete')}
                        onClick={() => store.removeBatchApk(apkPath)}
                      >
                        ×
                      </button>
                    </div>
                  ))
                )}
              </div>
              <label className={Style.systemRow}>
                <input
                  type="checkbox"
                  checked={store.batchSkipVerification}
                  onChange={(e) =>
                    store.setBatchSkipVerification(e.target.checked)
                  }
                />
                <span>{t('batchSkipVerification')}</span>
              </label>
              <div className={Style.systemTip}>
                {t('batchSkipVerificationTip')}
              </div>
            </div>
          ) : (
            <div className={Style.taskBody}>
              <textarea
                className={Style.packageInput}
                rows={7}
                value={store.batchPackages}
                placeholder={t('batchPackagePlaceholder')}
                onChange={(e) => store.setBatchPackages(e.target.value)}
              />
              <div className={Style.packageMeta}>
                <span>
                  {t('batchPackageCount', {
                    count: store.parsePackages().length,
                  })}
                </span>
                {store.invalidPackageCount() > 0 ? (
                  <span className={Style.warning}>
                    {t('batchInvalidPackages', {
                      count: store.invalidPackageCount(),
                    })}
                  </span>
                ) : null}
              </div>
              <label className={Style.systemRow}>
                <input
                  type="checkbox"
                  checked={store.batchAllowSystemUninstall}
                  onChange={(e) =>
                    store.setBatchAllowSystemUninstall(e.target.checked)
                  }
                />
                <span>{t('batchSystemForce')}</span>
              </label>
              <div className={Style.systemTip}>{t('batchSystemTip')}</div>
            </div>
          )}

          {store.batchSection !== 'terminal' ? (
            <>
              <div className={Style.options}>
                <label className={Style.option}>
                  <span>{t('batchConcurrency')}</span>
                  <select
                    value={store.batchConcurrency}
                    onChange={(e) =>
                      store.setBatchConcurrency(toNum(e.target.value))
                    }
                  >
                    {map([1, 2, 3, 4, 6, 8], (value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={Style.option}>
                  <span>{t('batchTimeout')}</span>
                  <input
                    type="number"
                    min={10}
                    max={3600}
                    step={30}
                    value={store.batchTimeout}
                    onChange={(e) =>
                      store.setBatchTimeout(toNum(e.target.value))
                    }
                  />
                </label>
                <span className={Style.spacer} />
                <button
                  className={className('button', 'primary', Style.startButton, {
                    disabled: startDisabled,
                  })}
                  onClick={start}
                  disabled={startDisabled}
                >
                  {store.batchRunning
                    ? t('batchRunning', store.batchProgress)
                    : preflighting
                    ? t('batchDetecting')
                    : t('batchStart')}
                </button>
              </div>
              {store.batchRunning ? (
                <div className={Style.progressBar}>
                  <div
                    className={Style.progressInner}
                    style={{ width: `${progress}%` }}
                  />
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      <div className={Style.resultArea}>
        <div className={Style.resultHeader}>
          <span className={Style.resultTitle}>
            {store.batchSection === 'terminal'
              ? t('batchTerminal')
              : t('batchResultTitle')}
          </span>
          {store.batchSection === 'terminal' ? (
            isEmpty(store.terminalResults) ? null : (
              <span className={Style.summary}>
                {t('terminalDeviceCount', {
                  count: store.terminalResults.length,
                })}
              </span>
            )
          ) : isEmpty(cells) ? null : (
            <span className={Style.summary}>
              {t('batchSummary', {
                success: summary.success,
                failure: summary.failure,
                skipped: summary.skipped,
              })}
            </span>
          )}
          <span className={Style.spacer} />
          <button
            className={className('button', Style.smallButton)}
            onClick={copyAll}
            disabled={isEmpty(cells) && isEmpty(store.terminalResults)}
          >
            {t('batchCopyLog')}
          </button>
          <button
            className={className('button', Style.smallButton)}
            onClick={exportAll}
            disabled={isEmpty(cells) && isEmpty(store.terminalResults)}
          >
            {t('batchExportLog')}
          </button>
        </div>

        {store.batchSection === 'terminal' ? (
          <div className={Style.terminalResults}>
            {isEmpty(store.terminalResults) ? (
              <div className={Style.empty}>{t('terminalNoResult')}</div>
            ) : (
              map(store.terminalResults, (result) => (
                <div className={Style.terminalResult} key={result.deviceId}>
                  <div className={Style.terminalResultHeader}>
                    <span className={Style.terminalDevice}>
                      {result.deviceName}
                    </span>
                    <span className={Style.deviceId}>{result.deviceId}</span>
                    <span
                      className={className(
                        Style.terminalStatus,
                        Style[result.status]
                      )}
                    >
                      {terminalStatusText(result.status)}
                    </span>
                    <span className={Style.deviceId}>{result.duration}ms</span>
                  </div>
                  <pre className={Style.terminalOutput}>
                    {result.output || t('batchNoOutput')}
                  </pre>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className={Style.resultBody}>
            <div className={Style.matrixWrap}>
              {isEmpty(cells) ? (
                <div className={Style.empty}>{t('batchNoResult')}</div>
              ) : (
                <table className={Style.matrix}>
                  <thead>
                    <tr>
                      <th className={Style.matrixCorner}>{t('batchDevice')}</th>
                      {map(matrix.tasks, (task) => (
                        <th key={task.id} title={task.id}>
                          <span className={Style.taskLabel}>{task.label}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {map(matrix.devices, (device) => (
                      <tr key={device.id}>
                        <th
                          className={Style.matrixRowHeader}
                          title={device.name}
                        >
                          <span className={Style.deviceName}>
                            {device.name || device.id}
                          </span>
                          <span className={Style.deviceId}>{device.id}</span>
                        </th>
                        {map(matrix.tasks, (task) => {
                          const cell = matrix.getCell(device.id, task.id)
                          if (!cell) {
                            return <td key={task.id} />
                          }

                          return (
                            <td key={task.id}>
                              <button
                                className={className(
                                  Style.cell,
                                  Style[cell.status],
                                  {
                                    [Style.cellActive]:
                                      store.batchActiveKey === cell.key,
                                  }
                                )}
                                title={cell.message}
                                onClick={() =>
                                  store.setBatchActiveKey(cell.key)
                                }
                              >
                                {statusText(cell.status)}
                              </button>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className={Style.outputPane}>
              {activeCell ? (
                <>
                  <div className={Style.outputHeader}>
                    <span className={Style.outputTitle}>
                      {activeCell.deviceName} · {activeCell.taskLabel}
                    </span>
                    <button
                      className={className('button', Style.smallButton)}
                      onClick={copyCell}
                    >
                      {t('batchCopyCell')}
                    </button>
                  </div>
                  <div className={Style.outputMeta}>
                    <span>{actionText(activeCell.action)}</span>
                    <span>{statusText(activeCell.status)}</span>
                    <span>{activeCell.duration}ms</span>
                  </div>
                  {activeCell.message &&
                  !activeCell.output.includes(activeCell.message) ? (
                    <div className={Style.outputMessage}>
                      {activeCell.message}
                    </div>
                  ) : null}
                  <pre className={Style.output}>
                    {activeCell.output || t('batchNoOutput')}
                  </pre>
                </>
              ) : (
                <div className={Style.empty}>{t('batchSelectCell')}</div>
              )}
            </div>
          </div>
        )}
      </div>

      {presetsVisible ? (
        <div
          className={Style.presetMask}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setPresetsVisible(false)
            }
          }}
        >
          <div className={Style.presetModal}>
            <div className={Style.presetHeader}>
              <span>{t('terminalPresetManager')}</span>
              <button
                className={Style.presetClose}
                onClick={() => setPresetsVisible(false)}
              >
                ×
              </button>
            </div>
            <div className={Style.presetRows}>
              {map(draftPresets, (preset, index) => (
                <div className={Style.presetRow} key={preset.id}>
                  <input
                    className={Style.presetInput}
                    value={preset.label}
                    placeholder={t('terminalPresetName')}
                    onChange={(e) =>
                      updateDraftPreset(index, 'label', e.target.value)
                    }
                  />
                  <input
                    className={Style.presetInput}
                    value={preset.command}
                    placeholder={t('terminalPresetCommand')}
                    onChange={(e) =>
                      updateDraftPreset(index, 'command', e.target.value)
                    }
                  />
                  <button
                    className={Style.presetDelete}
                    title={t('terminalDeletePreset')}
                    onClick={() => removeDraftPreset(index)}
                  >
                    ×
                  </button>
                </div>
              ))}
              {isEmpty(draftPresets) ? (
                <div className={Style.empty}>{t('terminalPresetHint')}</div>
              ) : null}
            </div>
            <div className={Style.presetActions}>
              <button
                className={className('button', Style.smallButton)}
                onClick={addDraftPreset}
              >
                {t('terminalAddPreset')}
              </button>
              <button
                className={className('button', Style.smallButton)}
                onClick={resetDraftPresets}
              >
                {t('terminalResetPresets')}
              </button>
              <span className={Style.spacer} />
              <button
                className={className('button', Style.smallButton)}
                onClick={() => setPresetsVisible(false)}
              >
                {t('terminalCancel')}
              </button>
              <button
                className={className('button', 'primary', Style.smallButton)}
                onClick={savePresetManager}
              >
                {t('save')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
})
