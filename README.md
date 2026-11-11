# Eaglet

**Fast. Private. Electric.** A desktop VPN client with six swappable interface
styles.

![Electric Cyber](screenshots/theme-cyber.png)

## Highlights

- Six complete interface styles — Electric Cyber, Glassmorphism, Minimal Dark,
  HUD/Scifi, Neon Purple and Nature Aurora — switchable live from Settings.
- Frameless window with a custom titlebar and a compact always-on-top mini mode.
- Animated connection dial, live latency/throughput telemetry, dotted world map
  with an animated encrypted-route arc.
- Server catalogue, split-tunnelling and DNS controls, kill-switch toggles,
  event log and session statistics.
- Electron + React + TypeScript, zero UI dependencies.

> **Status:** the tunnel engine is currently a simulator. The UI, IPC contract
> and state machine are production-shaped; swapping in a WireGuard transport is
> a contained change described in [CLAUDE.md](CLAUDE.md).

## Quick start

```bash
npm install
npm run dev        # development session with HMR
npm run build      # production bundles into out/
npm start          # preview the production build
```

Other scripts: `npm run typecheck`, `npm run map` (regenerate the world map),
`npm run shots` (capture one screenshot per theme), `npm run dist`
(electron-builder installers).

## Project structure

```
src/shared   IPC contract and domain types
src/main     Electron main process, settings store, VPN engine
src/preload  contextBridge API (window.eaglet)
src/renderer React interface — components, pages, themes
```

See [CLAUDE.md](CLAUDE.md) for architecture notes, the theme system and the
WireGuard integration path.

## License

MIT
