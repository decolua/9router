## Resolution — Research Findings: Cursor IDE Endpoint Injection

### 1. Storage Location Investigation
Probed Cursor IDE on Windows 11 (`%APPDATA%\Cursor\User\globalStorage\state.vscdb` + `settings.json` + `storage.json`):

- **OpenAI Key Storage**: Stored at `secret://cursorAuth/openAIKey` in `state.vscdb`. The value is a DPAPI/Electron-safe-storage encrypted binary buffer (`v10...` header, length 277 bytes). It **cannot** be written directly via SQLite from an external process without corrupting Cursor's credential store or triggering key-decryption errors.
- **Base URL Storage**: Cursor does **not** persist `openai.baseUrl` or any `overrideApiUrl` in `state.vscdb` or `storage.json`. In current Cursor builds (0.45+), the Override OpenAI Base URL setting is held in Cursor's internal React app state and synced to Cursor's cloud profile, not exposed in `settings.json`.
- **Environment Variables**: Cursor IDE ignores `OPENAI_BASE_URL` and `OPENAI_API_KEY` process-level environment variables for its own native model calls (it strictly uses its internal client).

### 2. The Practical Solution: Static One-Time Config (Zero-Maintenance)
Since ticket #10 decoupled the local gateway from the tunnel and established:
```
http://127.0.0.1:20128/v1
```
as a permanent, sub-second direct loopback:

1. **Configure Cursor ONCE** (Cursor Settings → Models → OpenAI API Key: any string e.g. `sk-9router`, Override OpenAI Base URL: `http://127.0.0.1:20128/v1`).
2. **Never change it again**: Because `127.0.0.1:20128` is a static local port, the endpoint never rotates, never depends on Cloudflare tunnel URLs, and never requires copy-pasting after restarts.
3. **Automated Verification Script**: Provided in `cli/src/cli/utils/endpoint.js` via `getLocalEndpoint()` to display/verify the exact URL to use.
4. **MITM Fallback Alternative**: 9Router's built-in MITM mode (`daily-cloudcode-pa.googleapis.com` / `api.individual.githubcopilot.com`) intercepts IDE traffic at the network/DNS layer with zero IDE-side config changes, if full automation without touching Cursor settings is desired.

### Conclusion
Direct SQLite injection into `state.vscdb` is unsafe due to DPAPI encryption. The robust architectural pattern is **static loopback targeting (`http://127.0.0.1:20128/v1`)** configured once, eliminating all future manual sync.
