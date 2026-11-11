import { contextBridge, ipcRenderer } from 'electron'
import type {
  CoreState,
  EagletApi,
  FreeDiscoveryResult,
  ImportResult,
  Profile,
  SessionRecord,
  Settings,
  Snapshot,
  SpeedTestResult
} from '@shared/types'

const api: EagletApi = {
  snapshot: () => ipcRenderer.invoke('app:snapshot'),
  connect: (profileId?: string) => ipcRenderer.invoke('vpn:connect', profileId),
  quickConnect: (): Promise<Profile> => ipcRenderer.invoke('vpn:quick-connect'),
  disconnect: () => ipcRenderer.invoke('vpn:disconnect'),
  selectProfile: (profileId: string) => ipcRenderer.invoke('vpn:select-profile', profileId),
  setFavorite: (profileId: string, favorite: boolean): Promise<Profile[]> =>
    ipcRenderer.invoke('profiles:favorite', profileId, favorite),
  importProfiles: (text: string): Promise<ImportResult> => ipcRenderer.invoke('profiles:import', text),
  discoverFree: (): Promise<FreeDiscoveryResult> => ipcRenderer.invoke('free:discover'),
  addFreeProfiles: (links: string[]): Promise<ImportResult> => ipcRenderer.invoke('free:add', links),
  updateSubscription: (id: string): Promise<ImportResult> => ipcRenderer.invoke('subscriptions:update', id),
  removeSubscription: (id: string) => ipcRenderer.invoke('subscriptions:remove', id),
  removeProfile: (id: string) => ipcRenderer.invoke('profiles:remove', id),
  testProfiles: (ids?: string[]): Promise<Profile[]> => ipcRenderer.invoke('profiles:test', ids),
  runSpeedTest: (): Promise<SpeedTestResult> => ipcRenderer.invoke('speed:test'),
  clearSessions: (): Promise<SessionRecord[]> => ipcRenderer.invoke('sessions:clear'),
  copyText: (text: string) => ipcRenderer.invoke('clipboard:write', text),
  readClipboard: (): Promise<string> => ipcRenderer.invoke('clipboard:read'),
  checkIp: () => ipcRenderer.invoke('ip:check'),
  refreshCore: (): Promise<CoreState> => ipcRenderer.invoke('core:refresh'),
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
