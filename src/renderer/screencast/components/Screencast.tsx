import { observer } from 'mobx-react-lite'
import store from '../store'
import { useEffect, useRef, useState } from 'react'
import Style from './Screencast.module.scss'
import endWith from 'licia/endWith'
import { LoadingBar } from 'share/renderer/components/loading'
import { installPackages } from '../../lib/util'
import { t } from 'common/util'

export default observer(function Screencast() {
  const { device, scrcpyClient, mode, frame } = store
  const screenContainerRef = useRef<HTMLDivElement>(null)
  const dragStart = useRef<{ x: number; y: number } | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    preload.setTitle(device.name)

    if (mode !== 'scrcpy') {
      setIsLoading(false)
      return
    }

    async function start() {
      const video = await scrcpyClient.getVideo()
      if (store.mode !== 'scrcpy') {
        return
      }
      video.stream.pipeTo(video.decoder.writable)
      screenContainerRef.current!.appendChild(video.decoder.renderer.element)
      setIsLoading(false)
    }
    start()

    return () => scrcpyClient.destroy()
  }, [mode])

  function toDevicePoint(e: React.PointerEvent<HTMLImageElement>) {
    const img = e.currentTarget
    const width = img.naturalWidth
    const height = img.naturalHeight
    if (!width || !height) {
      return null
    }
    const rect = img.getBoundingClientRect()
    const scale = Math.min(rect.width / width, rect.height / height)
    const left = rect.left + (rect.width - width * scale) / 2
    const top = rect.top + (rect.height - height * scale) / 2
    const x = Math.round((e.clientX - left) / scale)
    const y = Math.round((e.clientY - top) / scale)
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return null
    }

    return { x, y }
  }

  function onPointerDown(e: React.PointerEvent<HTMLImageElement>) {
    const point = toDevicePoint(e)
    if (!point) {
      return
    }
    dragStart.current = point
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onPointerUp(e: React.PointerEvent<HTMLImageElement>) {
    const start = dragStart.current
    const end = toDevicePoint(e)
    dragStart.current = null
    if (!start || !end) {
      return
    }
    const distance = Math.hypot(end.x - start.x, end.y - start.y)
    const command =
      distance > 10
        ? `input swipe ${start.x} ${start.y} ${end.x} ${end.y} 200`
        : `input tap ${end.x} ${end.y}`
    main.runShellCommand(device.id, command, 10000).catch(() => {})
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault()

    const files = e.dataTransfer.files
    const apkPaths: string[] = []
    for (let i = 0, len = files.length; i < len; i++) {
      const path = preload.getPathForFile(files[i])
      if (!endWith(path, '.apk')) {
        continue
      }
      apkPaths.push(path)
    }
    await installPackages(device.id, apkPaths)
  }

  return (
    <div
      ref={screenContainerRef}
      className={Style.container}
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      {mode === 'frames' ? (
        <div className={Style.frames}>
          {frame ? (
            <img
              className={Style.frameImage}
              src={frame}
              draggable={false}
              onPointerDown={onPointerDown}
              onPointerUp={onPointerUp}
            />
          ) : (
            <LoadingBar />
          )}
          <div className={Style.fallbackTip}>
            {t(
              store.frameSource === 'minicap'
                ? 'screencastMinicap'
                : 'screencastFallback'
            )}
          </div>
        </div>
      ) : (
        isLoading && <LoadingBar />
      )}
    </div>
  )
})
