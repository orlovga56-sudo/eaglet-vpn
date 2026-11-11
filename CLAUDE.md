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

The tunnel itself is currently **simulated** (see "VPN engine" below). The
architecture is deliberately shaped so that swapping in a real WireGuard
transport is a contained change.

## Tech stack

| Layer     | Choice                                       | Why                                            |
| --------- | -------------------------------------------- | ---------------------------------------------- |
| Shell     | Electron (frameless window)                  | Needs pixel-level control over the chrome      |
| UI        | React 19 + TypeScript                        | Component model for the six themes             |
| Build     | electron-vite (Vite 8)                       | HMR in dev, single `build` for main/preload/UI |
| Styling   | Hand-written CSS with custom properties      | Max fidelity to the concept sheet, zero deps   |
| Map       | Pre-rendered Natural Earth path (`npm run map`) | Offline, no runtime mapping dependency       |
| Packaging | electron-builder                             | `npm run dist` builds installers               |

No CSS framework, no component library, no icon package — icons are inline SVG
in `src/renderer/src/components/Icons.tsx`.

## Commands

```bash
npm run dev        # HMR dev session (Electron + Vite)
npm run build      # bundle main, preload and renderer into out/
npm start          # preview the production bundle
npm run typecheck  # tsc for node + web projects
npm run map        # regenerate the dotted world map from world-atlas data
npm run shots      # render offscreen and capture screenshots/theme-*.png
npm run dist       # electron-builder installers
```

> On this machine `npm`, `git` and `gh` are not on `PATH` for the shell; use
> the full paths (e.g. `& 'C:\Program Files\nodejs\npm.cmd'`) or prepend them.

## Repository layout

```
src/
  shared/types.ts        # Single source of truth for the IPC contract
  main/
    index.ts             # Window, IPC handlers, mini-mode, screenshot harness
    store.ts             # JSON settings persistence (userData/settings.json)
    vpn/
      engine.ts          # State machine + traffic simulator (replaceable)
      servers.ts         # Node catalogue with map coordinates
  preload/index.ts       # contextBridge → window.eaglet
  renderer/
    index.html
    src/
      App.tsx            # Routing between pages, theme override plumbing
      format.ts          # Speed/bytes/duration formatters
      data/worldMap.json # Generated — do not hand-edit (npm run map)
      components/        # TitleBar, Sidebar, PowerDial, WorldMap, …
      pages/             # Home, Servers, Routing, Stats, Settings, MiniView
      styles/theme.css   # Theme tokens + backdrops
      styles/app.css     # Layout and components
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

`src/main/vpn/engine.ts` owns a `VpnEngine extends EventEmitter` with the state
machine `disconnected → connecting → connected → disconnecting` and a traffic
simulator (mean-reverting latency, eased throughput, 60-sample history).

To make Eaglet a real client:

1. Create `src/main/vpn/wireguard.ts` exposing `connect(server)`,
   `disconnect()` and a `stats()` poller. On Windows the usual approach is a
   bundled `wireguard.exe` / WireGuard DLL plus a generated tunnel config.
2. Replace the `establish()` / `tick()` / `disconnect()` internals of
   `VpnEngine` with calls into that adapter. **Keep the public surface
   (`getState`, `connect`, `disconnect`, `selectServer`, `'state'` event) and
   the `VpnState` shape** — the renderer and preload depend on it.
3. Feed real numbers into `metrics` and `history`; the UI needs no changes.

The `Mock`/`Simulated` nature of the current engine is intentional and must be
documented in any user-facing text until a real adapter lands.

## IPC contract

All renderer↔main traffic goes through `window.eaglet` (`src/shared/types.ts`
defines `EagletApi`):

- `snapshot()` → full `Snapshot` (state + settings + servers + version)
- `connect(serverId?)`, `disconnect()`, `selectServer(id)`
- `updateSettings(patch)` → persisted `Settings`
- `setMini(bool)`, `windowMinimize()`, `windowClose()`,
  `windowToggleMaximize()`
- `onState(cb)` → main pushes a new `Snapshot` on every engine tick

Do not add `nodeIntegration`; the renderer must stay sandboxed behind preload.

## Conventions

- TypeScript strict mode; no `any` in committed code.
- Comments explain *why*; the code says *what*.
- Keep components presentational — data and actions arrive as props from
  `App.tsx`.
- Russian-speaking users: UI copy stays in English to match the concept sheet.

## Screenshot harness

`npm run shots` builds the app and launches the main process with
`--eaglet-shots`. `scheduleShots()` in `src/main/index.ts` then walks the six
themes, calls `window.__eagletSetTheme(id)` inside the renderer and writes
`screenshots/theme-*.png`. It also captures the connected state
(`connected.png`), every page (`page-*.png`) and compact mode (`mini.png`).
Use it to verify visual changes without a human looking at the screen. The
window is shown during capture (`showInactive`) and `backgroundThrottling` is
off, otherwise Chromium may return stale frames.
