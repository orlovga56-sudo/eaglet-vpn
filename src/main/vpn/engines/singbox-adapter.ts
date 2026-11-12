import type { EngineId, ProtocolId } from '@shared/types'
import { buildConfig } from '../singbox'
import { parseSemver, type EngineAdapter } from './types'

const ALL_PROTOCOLS: ProtocolId[] = [
  'vless',
  'vmess',
  'trojan',
  'shadowsocks',
  'hysteria2',
  'tuic',
  'socks',
  'http',
  'direct'
]

export const singboxAdapter: EngineAdapter = {
  id: 'sing-box' as EngineId,
  name: 'sing-box',
  releaseRepo: 'SagerNet/sing-box',
  protocols: ALL_PROTOCOLS,
  telemetry: true,
  supportsTun: true,
  assetPattern: (platform, arch) => {
    const cpu = arch === 'arm64' ? 'arm64' : 'amd64'
    const tag =
      platform === 'win32' ? `windows-${cpu}` : platform === 'darwin' ? `darwin-${cpu}` : `linux-${cpu}`
    return new RegExp(`-${tag}\\.(zip|tar\\.gz)$`)
  },
  binaryName: (platform) => (platform === 'win32' ? 'sing-box.exe' : 'sing-box'),
  configFileName: 'config.json',
  buildConfig: ({ profile, settings, mixedPort, apiPort, apiSecret }) =>
    JSON.stringify(buildConfig(profile, settings, mixedPort, apiPort, apiSecret), null, 2),
  validateArgs: (configPath) => ['check', '-c', configPath],
  versionArgs: ['version'],
  parseVersion: (output) => parseSemver(output.match(/sing-box version[^\n]*/)?.[0] ?? output),
  runArgs: (configPath) => ['run', '-c', configPath]
}
