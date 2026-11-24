import { contextBridge } from 'electron'
import net from 'node:net'
import mainObj from './main'
import nodeObj from 'share/preload/node'
import preloadObj from 'share/preload/preload'

// The screencast window needs a TCP client for scrcpy's tunnel_forward mode.
// Keep it here instead of modifying the electron-share submodule.
const nodeApi = {
  ...nodeObj,
  connect(port: number, listener: (socket: any) => void) {
    const socket = net.connect(port, '127.0.0.1')
    const adapter = {
      on(event: string, cb: (...args: any[]) => void) {
        socket.on(event, cb)
      },
      once(event: string, cb: (...args: any[]) => void) {
        socket.once(event, cb)
      },
      write(buffer: Uint8Array | string, cb?: (err?: Error | null) => void) {
        return socket.write(buffer, cb)
      },
      end() {
        socket.end()
      },
      destroy() {
        socket.destroy()
      },
    }
    socket.once('connect', () => listener(adapter))
    socket.on('error', () => {})
    return adapter
  },
}

contextBridge.exposeInMainWorld('preload', preloadObj)
contextBridge.exposeInMainWorld('main', mainObj)
contextBridge.exposeInMainWorld('node', nodeApi)

declare global {
  const main: typeof mainObj
  const preload: typeof preloadObj
  const node: typeof nodeApi
}
