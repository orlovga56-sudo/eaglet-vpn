import { contextBridge, ipcRenderer } from 'electron'
import type {
  CoreState,
  DiagnosticsResult,
  EagletApi,
  EngineChoice,
  EngineId,
  EngineState,
  EngineSwitchRecord,
  FreeDiscoveryResult,
  ImportResult,
  Profile,
  QrImportResult,
  Scenario,
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
  importQr: (): Promise<QrImportResult> => ipcRenderer.invoke('profiles:qr'),
  discoverFree: (): Promise<FreeDiscoveryResult> => ipcRenderer.invoke('free:discover'),
  addFreeProfiles: (links: string[]): Promise<ImportResult> => ipcRenderer.invoke('free:add', links),
  updateSubscription: (id: string): Promise<ImportResult> => ipcRenderer.invoke('subscriptions:update', id),
  updateAllSubscriptions: (): Promise<ImportResult[]> => ipcRenderer.invoke('subscriptions:update-all'),
  removeSubscription: (id: string) => ipcRenderer.invoke('subscriptions:remove', id),
  removeProfile: (id: string) => ipcRenderer.invoke('profiles:remove', id),
  testProfiles: (ids?: string[]): Promise<Profile[]> => ipcRenderer.invoke('profiles:test', ids),
  runSpeedTest: (): Promise<SpeedTestResult> => ipcRenderer.invoke('speed:test'),
  clearSessions: (): Promise<SessionRecord[]> => ipcRenderer.invoke('sessions:clear'),
  importClipboard: (): Promise<ImportResult> => ipcRenderer.invoke('profiles:import-clipboard'),
  copyProfileLink: (profileId: string) => ipcRenderer.invoke('profiles:copy-link', profileId),
  checkIp: () => ipcRenderer.invoke('ip:check'),
  refreshCore: (): Promise<CoreState> => ipcRenderer.invoke('core:refresh'),
  refreshEngines: (): Promise<EngineState[]> => ipcRenderer.invoke('engines:refresh'),
  installEngine: (engine: EngineId): Promise<EngineState[]> => ipcRenderer.invoke('engines:install', engine),
  removeEngine: (engine: EngineId): Promise<EngineState[]> => ipcRenderer.invoke('engines:remove', engine),
  checkEngineUpdates: (): Promise<EngineState[]> => ipcRenderer.invoke('engines:check-updates'),
  setEngine: (engine: EngineChoice): Promise<Settings> => ipcRenderer.invoke('engines:set', engine),
  setProfileEngine: (profileId: string, engine: EngineId | null): Promise<Profile[]> =>
    ipcRenderer.invoke('profiles:engine', profileId, engine),
  applyScenario: (scenarioId: string) => ipcRenderer.invoke('scenarios:apply', scenarioId),
  saveScenario: (scenario: Scenario): Promise<Scenario[]> => ipcRenderer.invoke('scenarios:save', scenario),
  removeScenario: (scenarioId: string): Promise<Scenario[]> => ipcRenderer.invoke('scenarios:remove', scenarioId),
  diagnose: (): Promise<DiagnosticsResult> => ipcRenderer.invoke('diagnostics:run'),
  exportBackup: (): Promise<string | null> => ipcRenderer.invoke('backup:export'),
  importBackup: (): Promise<Snapshot | null> => ipcRenderer.invoke('backup:import'),
  exportConfig: (): Promise<string | null> => ipcRenderer.invoke('config:export'),
  clearEngineHistory: (): Promise<EngineSwitchRecord[]> => ipcRenderer.invoke('engine-history:clear'),
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
