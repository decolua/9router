## Destination

Automate 9router AI Gateway as a self-healing Windows 11 background service with sub-3-second local routing (`http://127.0.0.1:20128/v1`), optional persistent Named Cloudflare Tunnel, and automated endpoint synchronization to Cursor IDE.

## Notes

- OS: Windows 11 (win32 10.0.26200)
- User decisions:
  - Local Cursor on this PC uses direct `http://127.0.0.1:20128/v1` for instant sub-second boot.
  - Background service via Windows Scheduled Task with restart-on-failure (0 popup cmd windows).
  - Background tunnel runs asynchronously as Named Tunnel with persistent token.
  - Automated sync script to inject/update Cursor IDE config directly.
- Relevant skills: `update-cursor-settings`, `wayfinder`, `research`, `superpowers`

## Open Tickets

- [x] #9: [Configure 9router as auto-starting Windows Scheduled Task with watchdog](https://github.com/vitou-vitou/9router/issues/9) (`wayfinder:task`, Closed)
- [x] #10: [Decouple local gateway readiness from Cloudflare tunnel health check](https://github.com/vitou-vitou/9router/issues/10) (`wayfinder:task`, Closed)
- [x] #11: [Research automated injection of 9router endpoint into Cursor IDE state](https://github.com/vitou-vitou/9router/issues/11) (`wayfinder:research`, Closed)
- [ ] #12: [Prototype named Cloudflare tunnel with persistent token](https://github.com/vitou-vitou/9router/issues/12) (`wayfinder:prototype`, Frontier — unblocked)

## Decisions so far

- [#9 Configure 9router as auto-starting Windows Scheduled Task with watchdog](https://github.com/vitou-vitou/9router/issues/9): Implemented hidden VBS watchdog supervisor loop (`cli/src/cli/tray/autostart.js`) with 3s crash recovery and `scripts/setup-windows-autostart.ps1` for Windows 11 service control without terminal popups.
- [#10 Decouple local gateway readiness from Cloudflare tunnel health check](https://github.com/vitou-vitou/9router/issues/10): Made `waitForHealth` non-blocking; `enableTunnel` returns in <1s; added `getLocalEndpoint()` for static `http://127.0.0.1:20128/v1` loopback.
- [#11 Research automated injection of 9router endpoint into Cursor IDE state](https://github.com/vitou-vitou/9router/issues/11): Direct SQLite injection into `state.vscdb` is unsafe (DPAPI encryption). Solution: static one-time Cursor config of `http://127.0.0.1:20128/v1` — never changes, zero ongoing maintenance. MITM mode available as zero-config alternative.

## Not yet specified

- Windows toast notification on tunnel reconnection
- Multi-instance conflict resolution between tray app and background service
- Dynamic fallback to Tailscale Funnel if Cloudflare network is unreachable

## Out of scope

- Manual terminal CLI launching as standard workflow
- Ephemeral quick tunnels (`trycloudflare.com`) as primary endpoint for local IDE
