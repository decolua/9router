# Antigravity Protocol Fidelity

This document describes how to verify that 9router's Antigravity upstream traffic matches the installed Antigravity IDE client identity.

## Ground truth

Read the installed IDE identity from:

```bash
grep -oE '"ideVersion"[[:space:]]*:[[:space:]]*"[^"]+"' /opt/Antigravity/resources/app/product.json
```

Use the top-level `ideVersion`, not the VS Code base `version` field.

## Request fields that must match

- `User-Agent`: `antigravity/<ideVersion> <platform>/<arch>`
- `request.metadata.ideVersion`: same `<ideVersion>` as User-Agent
- OAuth bootstrap `Client-Metadata`: `{ ideType: 9, platform: <platform enum>, pluginType: 2 }`
- Upstream host: `cloudcode-pa.googleapis.com`
- No `x-request-source` header on final upstream requests
- `project`: real `cloudaicompanionProject` from `loadCodeAssist`/`onboardUser`, never a fabricated random value

## Capture real IDE request

1. Start 9router MITM from the dashboard or CLI-tools page.
2. Enable MITM DNS for Antigravity so `cloudcode-pa.googleapis.com` points to local MITM.
3. Trigger a simple real Antigravity IDE chat request.
4. Inspect raw request dump under the MITM log directory (`DATA_DIR/logs/mitm`, implemented by `src/mitm/logger.js`).

## Capture 9router proxy request

1. Send a simple request through 9router using an Antigravity-backed model.
2. Capture the final upstream request via MITM or debug dump.
3. Compare the fields in the checklist above.
