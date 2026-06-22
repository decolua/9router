# 9router → DurinDoor Migration Guide

> **BREAKING CHANGE** — The OS-level service identity has been renamed from `9router` to
> `durindoor`. Users with an installed service **must uninstall the old service and install
> the new one.** Follow the steps below before upgrading.

---

## 1. Uninstall the old service (run with your OLD binary)

```sh
9router service uninstall
```

This removes `~/.config/systemd/user/9router.service` (Linux) or
`~/Library/LaunchAgents/com.9router.server.plist` (macOS).

---

## 2. Upgrade the package

```sh
npm i -g durindoor@latest --prefer-online
```

---

## 3. Install the new service (run with your NEW binary)

```sh
durindoor service install
```

This registers `~/.config/systemd/user/durindoor.service` (Linux) or
`~/Library/LaunchAgents/com.durindoor.server.plist` (macOS).

---

## What changes automatically

### Data directory

On first run, DurinDoor detects an existing `~/.9router/` directory and **copies** it to
`~/.durindoor/`. The original `~/.9router/` is kept as a backup; you may delete it once
you confirm everything works.

### CLI sessions

**Preserved.** The internal auth token salt was not rotated, so existing CLI sessions
remain valid after the upgrade — no re-authentication required.

### Environment variables

DurinDoor reads `DURINDOOR_*` variables. For backwards compatibility, `NINE_ROUTER_*`
equivalents are accepted as fallbacks wherever `DURINDOOR_*` is absent.

Example:

| Old variable | New variable (preferred) |
|---|---|
| `NINE_ROUTER_PORT` | `DURINDOOR_PORT` |
| `NINE_ROUTER_HOST` | `DURINDOOR_HOST` |

---

## What does NOT change this release

- **Provider configuration** — all provider IDs, API keys, and connection settings are
  unchanged. No reconfiguration needed.
- **Protocol headers** — the OpenAI-compatible API endpoint and internal headers are
  unchanged.
- **Data** — combos, API keys, settings, and Hermes profiles carry over via the data-dir
  copy described above.

---

## Windows service

Windows service management (via `sc.exe` / node-windows) is not yet automated. If you
have a Windows service registered as `9Router`, remove it manually:

```bat
sc stop 9Router
sc delete 9Router
```

Then register the new service as `DurinDoor` — see [docs/service-windows.md](./service-windows.md).

---

## Rollback

If you need to revert:

1. `durindoor service uninstall`
2. Re-install the old package: `npm i -g 9router@<previous-version>`
3. `9router service install`

Your data directory copy (`~/.9router/`) is preserved for this purpose.
