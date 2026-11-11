import { contextBridge, ipcRenderer } from 'electron'
import type { EagletApi, Settings, Snapshot } from '@shared/types'

const api: EagletApi = {
  snapshot: () => ipcRenderer.invoke('app:snapshot'),
  connect: (serverId?: string) => ipcRenderer.invoke('vpn:connect', serverId),
  disconnect: () => ipcRenderer.invoke('vpn:disconnect'),
  selectServer: (serverId: string) => ipcRenderer.invoke('vpn:select-server', serverId),
  updateSettings: (patch: Partial<Settings>) => ipcRenderer.invoke('settings:update', patch),
  setMini: (mini: boolean) => ipcRenderer.invoke('window:set-mini', mini),
  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowClose: () => ipcRenderer.send('window:close'),
  windowToggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  onState: (cb: (snapshot: Snapshot) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: Snapshot): void => cb(data)
    ipcRenderer.on('app:state', handler)
    return () => ipcRenderer.removeListener('app:state', handler)
  }
}

contextBridge.exposeInMainWorld('eaglet', api)
