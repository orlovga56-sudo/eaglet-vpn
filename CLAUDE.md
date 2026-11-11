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
      free-sources.ts  public catalogs, TCP probe, live node verification
      system-proxy.ts  WinINET proxy enable/disable and crash recovery
  preload/index.ts     contextBridge → window.eaglet
  renderer/
    index.html
    src/
      App.tsx          page routing, theme override plumbing
      format.ts        speed/bytes/duration/date-time formatters
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
- `connect(profileId?, automatic?)` — stage machine: prepare profile → ensure
  core → build + `sing-box check` config → spawn → wait for the mixed port →
  probe the exit IP → enable the system proxy → connected. `automatic` keeps the
  reconnect counter; a manual connect resets it.
- `disconnect()` / `shutdown()` — stop telemetry, kill the process tree, restore
  the previous Windows proxy, and persist the finished session. Teardown takes
  one final Clash sample so short sessions record their real traffic.
- `checkIp()` — probes the direct address and, while connected, the exit
  address through the local inbound; sets `ip.changed` only when they differ.
- `testProfiles(ids?)` — TCP handshake latency per node.
- `runSpeedTest()` — downloads 10 MB through the mixed inbound with `curl` and
  returns `{ mbps, bytes, seconds, at }`; throws when no tunnel is live.
- `setSystemProxy(bool)` — live proxy toggle while a tunnel is up.
- `getState()` + `'state'` event — the renderer consumes full snapshots.

Resilience and history live in the same class: `onCoreExit()` marks the drop,
records the session and calls `scheduleReconnect()` (three attempts, 2.5 s × n,
skipped when `settings.autoReconnect` is off or the user stopped manually).
`finishSession()` writes at most one `SessionRecord` per connection; the store
keeps the last 40.

### Core integration (`singbox.ts`)

- Binary lookup: `resources/bin` (packaged `extraResources`), repo
  `resources/bin`, then `userData/bin`. `installCore()` can download the
  latest release as a fallback.
- `buildConfig(profile, settings, mixedPort, apiPort, secret)` emits a
  sing-box 1.14 config: mixed inbound, optional TUN inbound, the profile
  outbound, smart/global routing rules, the user's bypass list, optional DoH DNS
  with `route.default_domain_resolver`, and a Clash API on loopback.
  `bypassRules(settings)` splits the list into `domain_suffix` and `ip_cidr`
  rules and always places them before the mode rules so they win in Global mode
  too.
- `outboundFor(profile)` maps every supported share link. When adding a
  protocol, extend `parseProfileUri` in `profiles.ts` and this function, then
  verify with `sing-box check -c out/main/...` or the generated
  `userData/core/config.json`.
- Telemetry: GET `/connections` with the bearer secret; totals are diffed per
  second and converted to Mbps. Latency is a `curl` request through the local
  proxy every 5 s.

### Free-server finder (`free-sources.ts`)

`discoverFreeProfiles({ settings, corePath })` never trusts a catalog:

1. Downloads seven community lists (V2RayAggregator, NoMoreWalls, ermaozi,
   ts-sf/fly, Pawdroid, freefq, ripaojiedian) in parallel, parses them with the
   same `parseProfilesPayload` used by subscriptions, and dedupes by `profile.id`.
2. TCP-probes 140 random candidates (24 concurrent, 2.2 s timeout).
3. Boots up to 40 of the fastest in throwaway sing-box instances (4 concurrent,
   distinct loopback ports, TUN forced off) and keeps only nodes where `curl`
   through the local inbound gets a real IP from `ip-api.com`.
4. Returns working nodes sorted by handshake latency plus per-source statuses.

`free:add` stores the picked links with `sourceId = 'free-public-nodes'` and a
`eaglet://free-public` pseudo-subscription, so the whole set can be removed at
once. If the core is missing, discovery falls back to TCP-only results and sets
`verified: false` — the UI warns about it.

Dev harnesses (both write JSON because Electron's stdout is invisible on
Windows): `electron . --eaglet-free-test` reports catalogs and working nodes,
`electron . --eaglet-free-connect-test` adds found nodes, connects to the first
one that works, compares direct/exit IP and tears the tunnel down.

`electron . --eaglet-feature-test` covers the quality-of-life batch: favourite
round-trip, generated bypass rules, a real 10 MB speed test, a forced
`taskkill` of `sing-box.exe` to prove auto-reconnect, and the persisted session
row. It writes `feature-test.json` and restores the settings it changed.

### Windows routing

`system-proxy.ts` writes `HKCU\…\Internet Settings`, notifies WinINET and keeps
a JSON backup in `userData/proxy-backup.json`. `recoverStaleProxy()` runs at
startup so a crash never leaves the user behind a dead proxy. Always call the
restore path from `shutdown()`; the main process prevents quit until it runs.

## IPC contract

All renderer↔main traffic goes through `window.eaglet` (`src/shared/types.ts`
defines `EagletApi`):

- `snapshot()` → `Snapshot` (state + settings + profiles + subscriptions +
  sessions)
- `connect(profileId?)`, `quickConnect()` → picks the fastest node, `disconnect()`,
  `selectProfile(id)`, `setFavorite(id, bool)` → updated profiles
- `importProfiles(text)` — URL, share link or base64 list
- `discoverFree()` → reachable/verified public nodes; `addFreeProfiles(links)` —
  stores picked finder nodes as the `free-public-nodes` subscription
- `updateSubscription(id)`, `removeSubscription(id)`, `removeProfile(id)`
- `testProfiles(ids?)`, `runSpeedTest()`, `clearSessions()`, `checkIp()`,
  `refreshCore()`
- `copyText(text)`, `readClipboard()` — clipboard access stays in main
- `updateSettings(patch)` → persisted `Settings` (incl. `bypassList`,
  `autoReconnect`, `notifications`)
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
4. Exercise the quality-of-life batch: star a node and switch to the
   *Favourites* filter, copy its link and paste it back; add entries to
   *Routing → bypass list*, connect and confirm `userData/core/config.json`
   contains the expected `domain_suffix` / `ip_cidr` rules; run the speed test;
   disconnect and confirm the session appears in *Stats → Session history*.
   `electron . --eaglet-feature-test` automates the same checks and proves
   auto-reconnect by killing the core.
5. *Find free servers* in Servers must return at least one working node on a
   normal connection (catalogs are volatile, retry if the first pass is empty),
   and adding a node must create the *Free public nodes* subscription.
6. `npm run shots` exercises the whole flow (it seeds demo profiles, creates two
   real sessions, connects through the direct profile, clicks the speed test,
   captures screenshots and cleans up). Set `EAGLET_SHOT_FREE=1` to also capture
   the free-server panel.

## Conventions

- TypeScript strict mode; no `any` in committed code.
- Comments explain *why*; the code says *what*.
- Keep components presentational — data and actions arrive as props from
  `App.tsx`.
- Russian-speaking users: UI copy stays in English to match the concept sheet.

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
