# CLAUDE.md

Guidance for AI agents and humans working inside the **Eaglet** repository.

## What this project is

Eaglet is a desktop **VPN client** for Windows/macOS/Linux built with
**Electron + React + TypeScript + Vite**. Its defining feature is the interface
system: **six swappable visual themes** taken from the original concept sheet
(*Electric Cyber, Glassmorphism, Minimal Dark, HUD/Scifi, Neon Purple, Nature
Aurora*). Every screen, animation and accent colour is driven by CSS custom
properties, so a theme is purely a token set — no theme-specific component
code.

The tunnel is **real**: it runs the bundled [sing-box](https://sing-box.sagernet.org/)
core, generates a config from the selected profile, applies the Windows system
proxy and streams live telemetry through the core's Clash API.

## Tech stack

| Layer     | Choice                                       | Why                                            |
| --------- | -------------------------------------------- | ---------------------------------------------- |
| Shell     | Electron (frameless window)                  | Needs pixel-level control over the chrome      |
| UI        | React 19 + TypeScript                        | Component model for the six themes             |
| Build     | electron-vite (Vite 8)                       | HMR in dev, single `build` for main/preload/UI |
| Styling   | Hand-written CSS with custom properties      | Max fidelity to the concept sheet, zero deps   |
| Tunnel    | sing-box (child process + Clash API)         | All mainstream protocols, no native bindings   |
| Map       | Pre-rendered Natural Earth path (`npm run map`) | Offline, no runtime mapping dependency       |
| Packaging | electron-builder                             | `npm run dist` builds installers               |

No CSS framework, no component library, no icon package — icons are inline SVG
in `src/renderer/src/components/Icons.tsx`.

## Commands

```bash
npm install
npm run core       # download/sing-box into resources/bin
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

## Repository layout

```
resources/bin/         sing-box.exe + libcronet.dll (git-ignored, npm run core)
scripts/fetch-core.mjs downloads the core for the current platform
src/
  shared/types.ts      single source of truth for the IPC contract
  main/
    index.ts           window, IPC handlers, subscription fetching, shots
    store.ts           JSON settings/profiles/subscriptions persistence
    vpn/
      engine.ts        state machine, connect/teardown, IP probes, telemetry
      singbox.ts       core discovery/install, config builder, process, Clash API
      profiles.ts      share-link + base64 subscription parser
      system-proxy.ts  WinINET proxy enable/disable and crash recovery
  preload/index.ts     contextBridge → window.eaglet
  renderer/
    index.html
    src/
      App.tsx          page routing, theme override plumbing
      format.ts        speed/bytes/duration formatters
      data/worldMap.json
      components/      TitleBar, Sidebar, PowerDial, WorldMap, …
      pages/           Home, Servers, Routing, Stats, Settings, MiniView
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

## VPN engine

`src/main/vpn/engine.ts` owns `VpnEngine extends EventEmitter`. Public surface:

- `init()` / `refreshCore()` — discover the binary and read its version.
- `connect(profileId?)` — stage machine: prepare profile → ensure core →
  build + `sing-box check` config → spawn → wait for the mixed port → probe
  the exit IP → enable the system proxy → connected.
- `disconnect()` / `shutdown()` — stop telemetry, kill the process tree,
  restore the previous Windows proxy.
- `checkIp()` — probes the direct address and, while connected, the exit
  address through the local inbound; sets `ip.changed` only when they differ.
- `testProfiles(ids?)` — TCP handshake latency per node.
- `setSystemProxy(bool)` — live proxy toggle while a tunnel is up.
- `getState()` + `'state'` event — the renderer consumes full snapshots.

### Core integration (`singbox.ts`)

- Binary lookup: `resources/bin` (packaged `extraResources`), repo
  `resources/bin`, then `userData/bin`. `installCore()` can download the
  latest release as a fallback.
- `buildConfig(profile, settings, mixedPort, apiPort, secret)` emits a
  sing-box 1.14 config: mixed inbound, optional TUN inbound, the profile
  outbound, smart/global routing rules, optional DoH DNS with
  `route.default_domain_resolver`, and a Clash API on loopback.
- `outboundFor(profile)` maps every supported share link. When adding a
  protocol, extend `parseProfileUri` in `profiles.ts` and this function, then
  verify with `sing-box check -c out/main/...` or the generated
  `userData/core/config.json`.
- Telemetry: GET `/connections` with the bearer secret; totals are diffed per
  second and converted to Mbps. Latency is a `curl` request through the local
  proxy every 5 s.

### Windows routing

`system-proxy.ts` writes `HKCU\…\Internet Settings`, notifies WinINET and keeps
a JSON backup in `userData/proxy-backup.json`. `recoverStaleProxy()` runs at
startup so a crash never leaves the user behind a dead proxy. Always call the
restore path from `shutdown()`; the main process prevents quit until it runs.

## IPC contract

All renderer↔main traffic goes through `window.eaglet` (`src/shared/types.ts`
defines `EagletApi`):

- `snapshot()` → `Snapshot` (state + settings + profiles + subscriptions)
- `connect(profileId?)`, `disconnect()`, `selectProfile(id)`
- `importProfiles(text)` — URL, share link or base64 list
- `updateSubscription(id)`, `removeSubscription(id)`, `removeProfile(id)`
- `testProfiles(ids?)`, `checkIp()`, `refreshCore()`
- `updateSettings(patch)` → persisted `Settings`
- `setMini(bool)`, `windowMinimize()`, `windowClose()`,
  `windowToggleMaximize()`
- `onState(cb)` → main pushes a new `Snapshot` on every engine tick

Do not add `nodeIntegration`; the renderer must stay sandboxed behind preload.

## Testing checklist

1. `npm run typecheck && npm run build`.
2. Import `direct://Test` (or a real node) and connect. Confirm:
   - the mixed inbound opens and `curl --proxy http://127.0.0.1:<port>` works;
   - the WinINET proxy is set while connected and restored after disconnect;
   - speed/connection counters move on Stats;
   - Home shows direct and exit addresses.
3. `Get-Process sing-box` should be empty after disconnect.
4. `npm run shots` exercises the whole flow (it seeds demo profiles, connects
   through the direct profile, captures screenshots and cleans up).

## Conventions

- TypeScript strict mode; no `any` in committed code.
- Comments explain *why*; the code says *what*.
- Keep components presentational — data and actions arrive as props from
  `App.tsx`.
- Russian-speaking users: UI copy stays in English to match the concept sheet.

## Screenshot harness

`npm run shots` builds the app and launches the main process with
`--eaglet-shots`. `scheduleShots()` in `src/main/index.ts` seeds demo profiles
(source `__shots__`), walks the six themes, calls
`window.__eagletSetTheme(id)` / `window.__eagletSetPage(id)` inside the
renderer, connects to the direct profile and writes `screenshots/*.png`.
Seeded profiles are deleted and the tunnel is shut down before exit. The
window is shown during capture (`showInactive`) and `backgroundThrottling` is
off, otherwise Chromium may return stale frames.
