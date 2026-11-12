# CLAUDE.md

Guidance for AI agents and humans working inside the **Eaglet** repository.

## What this project is

Eaglet is a desktop **VPN client** for Windows/macOS/Linux built with
**Electron + React + TypeScript + Vite**. Its two defining features are:

1. **Three real tunnel cores** — sing-box, Xray-core and Mihomo — selected per
   profile, globally or automatically, each with its own native config adapter.
2. **Six swappable visual themes** — *Electric Cyber, Glassmorphism, Minimal
   Dark, HUD/Scifi, Neon Purple, Nature Aurora*. Every screen, animation and
   accent colour is driven by CSS custom properties, so a theme is purely a
   token set — no theme-specific component code.

The tunnel is real: Eaglet generates a native config, validates it with the
chosen core, spawns it, verifies the exit address through the local inbound,
applies system routing and protection, and restores everything on disconnect or
crash.

## Tech stack

| Layer     | Choice                                       | Why                                            |
| --------- | -------------------------------------------- | ---------------------------------------------- |
| Shell     | Electron (frameless window)                  | Needs pixel-level control over the chrome      |
| UI        | React 19 + TypeScript                        | Component model for the six themes             |
| Build     | electron-vite (Vite 8)                       | HMR in dev, single `build` for main/preload/UI |
| Styling   | Hand-written CSS with custom properties      | Max fidelity to the concept sheet, zero deps   |
| Tunnels   | sing-box, Xray-core, Mihomo (child processes)| All mainstream protocols, no native bindings   |
| Map       | Pre-rendered Natural Earth path (`npm run map`) | Offline, no runtime mapping dependency       |
| Packaging | electron-builder                             | `npm run dist` builds installers               |

No CSS framework, no component library, no icon package — icons are inline SVG
in `src/renderer/src/components/Icons.tsx`.

## Commands

```bash
npm install
npm run core       # download sing-box into resources/bin
npm run dev        # HMR dev session (Electron + Vite)
npm run build      # bundle main, preload and renderer into out/
npm start          # preview the production bundle
npm run typecheck  # tsc for node + web projects
npm run map        # regenerate the dotted world map from world-atlas data
npm run shots      # render offscreen and capture screenshots/*.png
npm run dist       # electron-builder installers
```

> On this machine `npm`, `git` and `gh` are not on `PATH` for the shell; use
> the full paths (e.g. `& 'C:\Program Files\nodejs\npm.cmd'`) or prepend them.
> Electron GUI harnesses must be started with `Start-Process -Wait`, otherwise
> the command returns before the app exits.

## Repository layout

```
resources/bin/         sing-box.exe + libcronet.dll (git-ignored, npm run core)
scripts/fetch-core.mjs downloads the bundled sing-box core
src/
  shared/types.ts      single source of truth for the IPC contract
  main/
    index.ts           window, IPC handlers, tray, subscriptions, QR/backup, shots
    store.ts           JSON settings/profiles/subscriptions/scenarios/sessions
    vpn/
      engine.ts        state machine, connect/teardown, telemetry, protection,
                       diagnostics, scenarios, engine comparison
      singbox.ts       sing-box config, Clash API, speed transfer, port helpers
      engines/
        manager.ts     discovery, install/update/remove, auto choice, TUN staging
        types.ts       EngineAdapter contract
        singbox-adapter.ts
        xray-adapter.ts + xray-stats.ts
        mihomo-adapter.ts
      firewall/        Windows Firewall, macOS pf, Linux iptables kill switch
      system-proxy/    WinINET, networksetup, GSettings backends
      dns-guard.ts     local DoH relay + system resolver backup/restore
      scenarios.ts     built-in Gaming/Performance/Privacy/Manual presets
      profiles.ts      share-link + base64 subscription parser
      free-sources.ts  public catalogs, TCP probe, live node verification
      geo.ts           DNS + ip-api geolocation (no invented coordinates)
      process-usage.ts CPU/RAM sampler for the core process
      engine-test.ts   dev harness for the full engine matrix
  preload/index.ts     contextBridge → window.eaglet
  renderer/
    index.html
    src/
      App.tsx          page routing, theme override plumbing
      format.ts        speed/bytes/duration/date-time formatters
      data/worldMap.json
      components/      TitleBar, Sidebar, PowerDial, WorldMap, …
      pages/           Home, Servers, Scenarios, Routing, Stats, Settings, MiniView
      styles/theme.css theme tokens + backdrops
      styles/app.css   layout and components
```

## The theme system

1. `src/renderer/src/styles/theme.css` defines every token under
   `[data-theme='<id>']` — background layers, panel fills, borders, text,
   `--accent`, `--accent-rgb`, `--glow`, radii, blur and the map palette.
2. `App.tsx` sets `document.documentElement.dataset.theme` from the persisted
   setting (`themeOverride` exists only for the screenshot harness).
3. `ThemeBackdrop.tsx` renders only the decorative layers relevant to the
   active theme (lightning bolts, glass blobs, aurora ribbons, HUD grid).

**Adding a theme:** add an id to `ThemeId` in `src/shared/types.ts`, add a
token block in `theme.css`, add an entry to `THEMES` in
`src/renderer/src/pages/Settings.tsx`, optionally add a backdrop in
`ThemeBackdrop.tsx`. Nothing else needs to change.

Design rules that keep the six styles coherent:

- Never hardcode a colour in a component — always use a token.
- Motion is subtle: 0.16–0.35s with `var(--ease)`; ambient loops are long.
- `hud` swaps the whole font stack to mono and squares the radii; keep labels
  short and uppercase-friendly.
- `minimal` has no glow (`--glow: none`) — do not add box-shadows conditionally
  in components.

## Multi-engine architecture

`src/main/vpn/engines/manager.ts` is the only place that knows about specific
cores. Every core implements `EngineAdapter` (`engines/types.ts`):

```ts
interface EngineAdapter {
  id: EngineId
  name: string
  releaseRepo: string
  protocols: ProtocolId[]
  telemetry: boolean
  supportsTun: boolean
  supportsProfile?: (profile: Profile) => boolean
  assetPattern(platform, arch): RegExp
  binaryName(platform): string
  configFileName: string
  buildConfig(input): string
  validateArgs(configPath): string[]
  versionArgs: string[]
  parseVersion(output): string | null
  runArgs(configPath): string[]
}
```

Key rules:

- `EngineManager.choose()` order is **profile override → global choice → auto**.
  Auto walks `sing-box, mihomo, xray`, requires an installed binary that
  `supportsProfile()` and, when `tunMode` is on, `supportsTun`.
- `supportsProfile()` is not just protocol membership. Xray’s adapter rejects
  legacy Shadowsocks ciphers (`aes-256-cfb`, …) before spawn; a pinned core that
  cannot carry the node is reported in the log and the manager falls back.
- `buildConfig()` receives `{ profile, settings, mixedPort, apiPort, auxPort,
  apiSecret }`. Xray has no mixed inbound, so `auxPort` is its SOCKS listener;
  `apiPort` is Xray’s native stats API, not a Clash API.
- `validate()` shells out to `sing-box check`, `xray run -test` or `mihomo -t`
  and surfaces stderr to the UI.
- `start()` spawns with `cwd = userData/bin` because Windows resolves `wintun.dll`
  relative to the working directory. `ensureTun()` downloads
  `wintun-0.14.1.zip` once, extracts the matching architecture and stages the
  core next to the DLL.
- Installs come from the official GitHub releases into `userData/bin`;
  `resources/bin` is only the bundled sing-box fallback. Archives whose payload
  name differs from the binary name (Mihomo) are matched by executable content,
  not by a fixed filename.
- Mihomo config uses explicit private CIDRs and
  `fallback-filter.geoip: false` so validation never downloads a GeoIP database.

### Engine state machine (`vpn/engine.ts`)

`VpnEngine extends EventEmitter` owns the runtime:

- `connect(profileId?, automatic?)` — probe direct IP → prepare/install core →
  optional TUN staging → build + validate native config → spawn → wait for the
  mixed port → verify exit IP → apply system proxy → arm protection → connected.
- `disconnect()` / `shutdown()` — one final telemetry sample, stop telemetry,
  kill the process tree, restore proxy, remove kill switch/DNS guard, persist the
  session, emit a disconnected snapshot.
- `onCoreExit()` — keeps protection armed during a crash, records the session and
  calls `scheduleReconnect()` (three attempts, 2.5 s × n).
- `applyProtection()` — real kill switch via `firewall/` and real DoH relay via
  `dns-guard.ts`. Both need elevation; failures are logged, never hidden.
- `diagnose()` — returns real checks (binary, version, config, proxy, TUN, kill
  switch, DNS, resolution, exit IP, latency, loss, subscriptions, updates,
  platform support).
- `applyScenario()` — writes real settings, selects an engine, records a switch
  and can pick the fastest/favourite server.
- `validateEngineConfig(id)` — builds a native config for one engine without
  connecting and runs its validator.
- `prepareTun()` — prepares `wintun.dll` and a staged core without opening a
  tunnel.

### Telemetry

- sing-box/Mihomo: Clash API (`/connections`) with the bearer secret.
- Xray: native `StatsService` through `xray api statsquery --server=…`; only
  inbound counters are summed. Sampled every other tick because it spawns the
  CLI.
- Latency: an HTTP probe through the local inbound every 5 s. Jitter is the mean
  absolute difference between consecutive samples; loss is failed probes divided
  by the rolling window.
- CPU/RAM: `process-usage.ts` reads the live core PID.
- `SessionRecord` stores the engine, traffic, duration, exit IP, ping, jitter
  and loss.

### Protection layers

| Layer | Windows | macOS | Linux |
| --- | --- | --- | --- |
| System proxy | WinINET registry | `networksetup` | GSettings (GNOME) |
| Kill switch | Firewall default outbound Block + allow rules | `pf` anchor | dedicated `iptables` chain |
| DNS protection | Local DoH relay on `127.0.0.1:53`, resolver backup/restore | same | same |
| TUN | `wintun.dll` + elevated core | — | — |

Support is deliberately asymmetric: only Windows is in the verified matrix;
macOS/Linux backends exist but are marked **experimental**. Never claim a
platform feature you have not tested.

## IPC contract

All renderer↔main traffic goes through `window.eaglet` (`src/shared/types.ts`
defines `EagletApi`). Highlights:

- snapshot/state: `snapshot()`, `onState(cb)`
- tunnel: `connect`, `quickConnect`, `disconnect`, `selectProfile`,
  `checkIp`, `runSpeedTest`
- profiles: `importProfiles`, `importQr`, `updateSubscription`,
  `updateAllSubscriptions`, `removeSubscription`, `removeProfile`,
  `setFavorite`, `testProfiles`, `clearSessions`
- engines: `refreshEngines`, `installEngine`, `removeEngine`,
  `checkEngineUpdates`, `setEngine`, `setProfileEngine`, `clearEngineHistory`
- scenarios/diagnostics: `applyScenario`, `saveScenario`, `removeScenario`,
  `diagnose`
- data: `exportBackup`, `importBackup`, `exportConfig`
- settings/window: `updateSettings`, `setMini`, minimize/close/maximize

Do not add `nodeIntegration`; the renderer must stay sandboxed behind preload.

## Dev harnesses

All harnesses write JSON because Electron’s stdout is invisible on Windows.

- `electron . --eaglet-engine-test` (`vpn/engine-test.ts`) — installs all three
  cores, validates standard/hardened configs, opens a real tunnel with each
  engine, kills each core to prove auto-reconnect, checks per-profile/global/auto
  selection, applies scenarios, verifies proxy restoration and TUN preparation,
  and performs an emergency shutdown. Protection layers that need elevation are
  reported as skipped. It restores the user’s settings, profile pins, session
  list and engine history before exit. Writes `engine-test.json`.
- `--eaglet-free-test` / `--eaglet-free-connect-test` — free-server catalogs and
  a real connection to a discovered node.
- `--eaglet-feature-test` — favourites, bypass rules, speed test, forced core
  kill and session persistence.

## Testing checklist

1. `npm run typecheck && npm run build`.
2. Run `electron . --eaglet-engine-test` (elevated when testing kill
   switch/DNS/TUN). All three engines must install, validate, connect, show live
   counters, reconnect after `taskkill`, and restore the proxy.
3. Import `direct://Test` or a real node and connect. Confirm the mixed inbound
   opens, WinINET proxy is restored after disconnect, telemetry moves, and Home
   shows direct/exit addresses.
4. Verify `Get-Process sing-box, xray, mihomo` is empty after disconnect.
5. Exercise split tunneling: add domains/CIDRs, connect, inspect
   `userData/core/config.json` (or `config.yaml`) for the expected direct rules.
6. Exercise the quality-of-life batch: star a node, copy/paste links, run the
   speed test, confirm the session row, apply a scenario, run diagnostics,
   export a backup and the active core config.
7. `npm run shots` seeds demo profiles, creates two real sessions, connects
   through the direct profile, clicks the speed test, captures every page
   (including Scenarios) and cleans up. Set `EAGLET_SHOT_FREE=1` to also capture
   the free-server panel.

## Conventions

- TypeScript strict mode; no `any` in committed code.
- Comments explain *why*; the code says *what*.
- Keep components presentational — data and actions arrive as props from
  `App.tsx`.
- Russian-speaking users: UI copy stays in English to match the concept sheet.
- Never invent server coordinates, telemetry, traffic or protection status. If a
  capability needs elevation or is not implemented, report it honestly.

## Screenshot harness

`npm run shots` builds the app and launches the main process with
`--eaglet-shots`. `scheduleShots()` in `src/main/index.ts` seeds demo profiles
(source `__shots__`, one starred), clears the session history, temporarily sets
a demo bypass list, runs two short real sessions (each with a 10 MB speed test),
then connects to the direct profile and writes `screenshots/*.png`. The stats
page is captured twice: once at the top and once scrolled to the session table.
Seeded profiles are deleted, the bypass list is restored and the tunnel is shut
down before exit. The window is shown during capture (`showInactive`) and
`backgroundThrottling` is off, otherwise Chromium may return stale frames.
