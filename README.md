# Eaglet

**Fast. Private. Electric.** A desktop VPN client on the **sing-box** core with
six swappable interface styles.

![Electric Cyber](screenshots/connected.png)

## What actually works

Eaglet is not a mock-up. The app bundles the real [sing-box](https://sing-box.sagernet.org/)
core (1.14.x) and drives it end to end:

- **Real profiles** — import a subscription URL, a base64 node list, or a single
  share link. VLESS (incl. Reality), VMess, Trojan, Shadowsocks, Hysteria2,
  TUIC, SOCKS, HTTP and a built-in direct route are supported.
- **Real tunnel** — Eaglet generates a core config, validates it with
  `sing-box check`, spawns the core, waits for the local mixed inbound and
  restores everything on disconnect or crash.
- **Real exit-IP verification** — the public address is measured **before** the
  tunnel starts and again **through** the tunnel. Home shows both addresses and
  flags a change only when they differ.
- **Real system routing** — one click flips the Windows WinINET proxy to the
  local inbound, with a backup of the previous settings; the backup is restored
  on disconnect, quit or after a crash. TUN mode is available for full-device
  capture (requires an administrator session).
- **Real telemetry** — download/upload speed, session totals, active
  connections and latency come from the core's Clash API; the event log streams
  the core's own output.
- **Happ-style conveniences** — subscription refresh/removal, latency tests,
  search, per-node connect, auto-connect on launch, launch at startup, compact
  always-on-top mode, DNS selection, kill-switch policy and six themes.

> **Bring your own server.** The repository contains no VPN subscription. To
> exercise the mechanics without one, import `direct://Test` — the tunnel,
> proxy, telemetry and IP probes are real, but the exit address cannot change
> because traffic leaves from your own machine. Add a real node (or any
> subscription) and the IP-change badge will verify it.

## Interface styles

Six complete themes ship in the box and switch live from Settings.

<table>
  <tr>
    <td width="50%"><img src="screenshots/theme-cyber.png" alt="Electric Cyber" /></td>
    <td width="50%"><img src="screenshots/theme-glass.png" alt="Glassmorphism" /></td>
  </tr>
  <tr>
    <td><b>Electric Cyber</b> — electric blue on deep space</td>
    <td><b>Glassmorphism</b> — frosted layers, violet light</td>
  </tr>
  <tr>
    <td><img src="screenshots/theme-minimal.png" alt="Minimal Dark" /></td>
    <td><img src="screenshots/theme-hud.png" alt="HUD / Scifi" /></td>
  </tr>
  <tr>
    <td><b>Minimal Dark</b> — quiet, typographic, precise</td>
    <td><b>HUD / Scifi</b> — telemetry green on black</td>
  </tr>
  <tr>
    <td><img src="screenshots/theme-neon.png" alt="Neon Purple" /></td>
    <td><img src="screenshots/theme-aurora.png" alt="Nature Aurora" /></td>
  </tr>
  <tr>
    <td><b>Neon Purple</b> — violet bloom after dark</td>
    <td><b>Nature Aurora</b> — northern lights over teal</td>
  </tr>
</table>

## Quick start

```bash
npm install
npm run core      # downloads sing-box into resources/bin (once)
npm run dev       # development session with HMR
npm run build     # production bundles into out/
npm start         # preview the production build
```

Other scripts: `npm run typecheck`, `npm run map` (regenerate the world map),
`npm run shots` (capture one screenshot per theme), `npm run package`
(unpacked build) and `npm run dist` (installers).

Electron-builder copies `resources/bin` into the packaged app via
`extraResources`, so run `npm run core` before `npm run dist`. If the binary is
missing at runtime, Eaglet can download the latest sing-box release into its
user-data folder on the first connect.

## Project structure

```
src/shared   IPC contract and domain types
src/main     Electron main process
  store.ts            settings, profiles and subscriptions (userData/config.json)
  vpn/engine.ts       state machine, connect/teardown, IP probes, telemetry
  vpn/singbox.ts      core discovery/install, config builder, process, Clash API
  vpn/profiles.ts     share-link and subscription parser
  vpn/system-proxy.ts Windows proxy enable/disable with backup/restore
src/preload  contextBridge API (window.eaglet)
src/renderer React interface — components, pages, themes
resources    core binaries and build resources (bin/ is git-ignored)
```

See [CLAUDE.md](CLAUDE.md) for architecture notes, the theme system and the
IPC contract.

## License

MIT
