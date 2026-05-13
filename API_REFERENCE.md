# HTTP API reference

Auto-generated from `src/app/api/**/route.js`. Regenerate:

```bash
node scripts/generate-api-reference.mjs
```

- **Base URL (local default):** `http://localhost:20128`
- **OpenAI-style prefix:** `/v1/:path*` rewrites to `/api/v1/:path*` (see `next.config.mjs`).
- **Auth:** Dashboard routes usually need a session cookie from `POST /api/auth/login`. `/api/v1/*` may require `Authorization: Bearer <api key>` when enabled.

```text
-H "Authorization: Bearer YOUR_API_KEY"
```

**Payloads:** Examples are minimal. For exact schemas, open the listed `route.js` and search for `request.json()`, `request.formData()`, or `request.text()`.

---

## `/api/auth/login`

**File:** `src/app/api/auth/login/route.js`

**What it does:** Block login via tunnel/tailscale if dashboard access is disabled

**Methods:** POST

### POST

**Example curl (`/api/auth/login`):**

```bash
curl -sS -X POST "http://localhost:20128/api/auth/login" -H "Content-Type: application/json" --data-raw '{"password":"YOUR_INITIAL_PASSWORD"}'
```

---

## `/api/auth/logout`

**File:** `src/app/api/auth/logout/route.js`

**What it does:** HTTP handler for `/api/auth/logout`. See source: `src/app/api/auth/logout/route.js`.

**Methods:** POST

### POST

**Example curl (`/api/auth/logout`):**

```bash
curl -sS -X POST "http://localhost:20128/api/auth/logout"
```

---

## `/api/auth/oidc/callback`

**File:** `src/app/api/auth/oidc/callback/route.js`

**What it does:** HTTP handler for `/api/auth/oidc/callback`. See source: `src/app/api/auth/oidc/callback/route.js`.

**Methods:** GET

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/auth/oidc/callback"
```

---

## `/api/auth/oidc/start`

**File:** `src/app/api/auth/oidc/start/route.js`

**What it does:** HTTP handler for `/api/auth/oidc/start`. See source: `src/app/api/auth/oidc/start/route.js`.

**Methods:** GET

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/auth/oidc/start"
```

---

## `/api/auth/oidc/test`

**File:** `src/app/api/auth/oidc/test/route.js`

**What it does:** HTTP handler for `/api/auth/oidc/test`. See source: `src/app/api/auth/oidc/test/route.js`.

**Methods:** POST

### POST

**Example curl (`/api/auth/oidc/test`):**

```bash
curl -sS -X POST "http://localhost:20128/api/auth/oidc/test" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/auth/status`

**File:** `src/app/api/auth/status/route.js`

**What it does:** HTTP handler for `/api/auth/status`. See source: `src/app/api/auth/status/route.js`.

**Methods:** GET

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/auth/status"
```

---

## `/api/cli-tools/all-statuses`

**File:** `src/app/api/cli-tools/all-statuses/route.js`

**What it does:** Batch endpoint: gather all CLI tool statuses in one round-trip

**Methods:** GET

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/cli-tools/all-statuses"
```

---

## `/api/cli-tools/antigravity-mitm/alias`

**File:** `src/app/api/cli-tools/antigravity-mitm/alias/route.js`

**What it does:** GET - Get MITM aliases for a tool

**Methods:** GET, PUT

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/cli-tools/antigravity-mitm/alias"
```

### PUT

**Example curl (`/api/cli-tools/antigravity-mitm/alias`):**

```bash
curl -sS -X PUT "http://localhost:20128/api/cli-tools/antigravity-mitm/alias" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/cli-tools/antigravity-mitm`

**File:** `src/app/api/cli-tools/antigravity-mitm/route.js`

**What it does:** localhost:20128";

**Methods:** GET, POST, DELETE, PATCH

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/cli-tools/antigravity-mitm"
```

### POST

**Example curl (`/api/cli-tools/antigravity-mitm`):**

```bash
curl -sS -X POST "http://localhost:20128/api/cli-tools/antigravity-mitm" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

### DELETE

```bash
curl -sS -X DELETE "http://localhost:20128/api/cli-tools/antigravity-mitm"
```

### PATCH

**Example curl (`/api/cli-tools/antigravity-mitm`):**

```bash
curl -sS -X PATCH "http://localhost:20128/api/cli-tools/antigravity-mitm" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/cli-tools/claude-settings`

**File:** `src/app/api/cli-tools/claude-settings/route.js`

**What it does:** Get claude settings path based on OS

**Methods:** GET, POST, DELETE

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/cli-tools/claude-settings"
```

### POST

**Example curl (`/api/cli-tools/claude-settings`):**

```bash
curl -sS -X POST "http://localhost:20128/api/cli-tools/claude-settings" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

### DELETE

```bash
curl -sS -X DELETE "http://localhost:20128/api/cli-tools/claude-settings"
```

---

## `/api/cli-tools/cline-settings`

**File:** `src/app/api/cli-tools/cline-settings/route.js`

**What it does:** Cline expects base WITHOUT /v1

**Methods:** GET, POST, DELETE

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/cli-tools/cline-settings"
```

### POST

**Example curl (`/api/cli-tools/cline-settings`):**

```bash
curl -sS -X POST "http://localhost:20128/api/cli-tools/cline-settings" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

### DELETE

```bash
curl -sS -X DELETE "http://localhost:20128/api/cli-tools/cline-settings"
```

---

## `/api/cli-tools/codex-settings`

**File:** `src/app/api/cli-tools/codex-settings/route.js`

**What it does:** Flatten confbox-parsed TOML into a writable object, preserving nested tables

**Methods:** GET, POST, DELETE

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/cli-tools/codex-settings"
```

### POST

**Example curl (`/api/cli-tools/codex-settings`):**

```bash
curl -sS -X POST "http://localhost:20128/api/cli-tools/codex-settings" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

### DELETE

```bash
curl -sS -X DELETE "http://localhost:20128/api/cli-tools/codex-settings"
```

---

## `/api/cli-tools/copilot-settings`

**File:** `src/app/api/cli-tools/copilot-settings/route.js`

**What it does:** Resolve chatLanguageModels.json path per OS

**Methods:** GET, POST, DELETE

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/cli-tools/copilot-settings"
```

### POST

**Example curl (`/api/cli-tools/copilot-settings`):**

```bash
curl -sS -X POST "http://localhost:20128/api/cli-tools/copilot-settings" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

### DELETE

```bash
curl -sS -X DELETE "http://localhost:20128/api/cli-tools/copilot-settings"
```

---

## `/api/cli-tools/cowork-mcp-registry`

**File:** `src/app/api/cli-tools/cowork-mcp-registry/route.js`

**What it does:** api.anthropic.com/mcp-registry/v0/servers";

**Methods:** GET

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/cli-tools/cowork-mcp-registry"
```

---

## `/api/cli-tools/cowork-mcp-tools`

**File:** `src/app/api/cli-tools/cowork-mcp-tools/route.js`

**What it does:** Probe MCP server: initialize + tools/list. No auth header — works for authless servers.

**Methods:** POST

### POST

**Example curl (`/api/cli-tools/cowork-mcp-tools`):**

```bash
curl -sS -X POST "http://localhost:20128/api/cli-tools/cowork-mcp-tools" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/cli-tools/cowork-settings`

**File:** `src/app/api/cli-tools/cowork-settings/route.js`

**What it does:** Hardcoded relax-security profile applied on every Apply.

**Methods:** GET, POST, DELETE

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/cli-tools/cowork-settings"
```

### POST

**Example curl (`/api/cli-tools/cowork-settings`):**

```bash
curl -sS -X POST "http://localhost:20128/api/cli-tools/cowork-settings" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

### DELETE

```bash
curl -sS -X DELETE "http://localhost:20128/api/cli-tools/cowork-settings"
```

---

## `/api/cli-tools/droid-settings`

**File:** `src/app/api/cli-tools/droid-settings/route.js`

**What it does:** Check if droid CLI is installed (via which/where or config file exists)

**Methods:** GET, POST, DELETE

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/cli-tools/droid-settings"
```

### POST

**Example curl (`/api/cli-tools/droid-settings`):**

```bash
curl -sS -X POST "http://localhost:20128/api/cli-tools/droid-settings" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

### DELETE

```bash
curl -sS -X DELETE "http://localhost:20128/api/cli-tools/droid-settings"
```

---

## `/api/cli-tools/hermes-settings`

**File:** `src/app/api/cli-tools/hermes-settings/route.js`

**What it does:** Match top-level "model:" block (until next non-indented, non-empty line)

**Methods:** GET, POST, DELETE

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/cli-tools/hermes-settings"
```

### POST

**Example curl (`/api/cli-tools/hermes-settings`):**

```bash
curl -sS -X POST "http://localhost:20128/api/cli-tools/hermes-settings" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

### DELETE

```bash
curl -sS -X DELETE "http://localhost:20128/api/cli-tools/hermes-settings"
```

---

## `/api/cli-tools/kilo-settings`

**File:** `src/app/api/cli-tools/kilo-settings/route.js`

**What it does:** Best-effort: update VS Code extension settings

**Methods:** GET, POST, DELETE

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/cli-tools/kilo-settings"
```

### POST

**Example curl (`/api/cli-tools/kilo-settings`):**

```bash
curl -sS -X POST "http://localhost:20128/api/cli-tools/kilo-settings" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

### DELETE

```bash
curl -sS -X DELETE "http://localhost:20128/api/cli-tools/kilo-settings"
```

---

## `/api/cli-tools/openclaw-settings`

**File:** `src/app/api/cli-tools/openclaw-settings/route.js`

**What it does:** Check if openclaw CLI is installed (via which/where or config file exists)

**Methods:** GET, POST, DELETE

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/cli-tools/openclaw-settings"
```

### POST

**Example curl (`/api/cli-tools/openclaw-settings`):**

```bash
curl -sS -X POST "http://localhost:20128/api/cli-tools/openclaw-settings" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

### DELETE

```bash
curl -sS -X DELETE "http://localhost:20128/api/cli-tools/openclaw-settings"
```

---

## `/api/cli-tools/opencode-settings`

**File:** `src/app/api/cli-tools/opencode-settings/route.js`

**What it does:** Check if opencode CLI is installed (via which/where or config file exists)

**Methods:** GET, POST, PATCH, DELETE

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/cli-tools/opencode-settings"
```

### POST

**Example curl (`/api/cli-tools/opencode-settings`):**

```bash
curl -sS -X POST "http://localhost:20128/api/cli-tools/opencode-settings" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

### PATCH

**Example curl (`/api/cli-tools/opencode-settings`):**

```bash
curl -sS -X PATCH "http://localhost:20128/api/cli-tools/opencode-settings" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

### DELETE

```bash
curl -sS -X DELETE "http://localhost:20128/api/cli-tools/opencode-settings"
```

---

## `/api/cloud/auth`

**File:** `src/app/api/cloud/auth/route.js`

**What it does:** Verify API key and return provider credentials

**Methods:** POST

### POST

**Example curl (`/api/cloud/auth`):**

```bash
curl -sS -X POST "http://localhost:20128/api/cloud/auth" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/cloud/credentials/update`

**File:** `src/app/api/cloud/credentials/update/route.js`

**What it does:** Update provider credentials (for cloud token refresh)

**Methods:** PUT

### PUT

**Example curl (`/api/cloud/credentials/update`):**

```bash
curl -sS -X PUT "http://localhost:20128/api/cloud/credentials/update" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/cloud/model/resolve`

**File:** `src/app/api/cloud/model/resolve/route.js`

**What it does:** Resolve model alias to provider/model

**Methods:** POST

### POST

**Example curl (`/api/cloud/model/resolve`):**

```bash
curl -sS -X POST "http://localhost:20128/api/cloud/model/resolve" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/cloud/models/alias`

**File:** `src/app/api/cloud/models/alias/route.js`

**What it does:** PUT /api/cloud/models/alias - Set model alias (for cloud/CLI)

**Methods:** PUT, GET

### PUT

**Example curl (`/api/cloud/models/alias`):**

```bash
curl -sS -X PUT "http://localhost:20128/api/cloud/models/alias" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/cloud/models/alias"
```

---

## `/api/combos/{id}`

**File:** `src/app/api/combos/[id]/route.js`

**What it does:** Validate combo name: only a-z, A-Z, 0-9, -, _

**Methods:** GET, PUT, DELETE

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/combos/{id}"
```

### PUT

**Example curl (`/api/combos/{id}`):**

```bash
curl -sS -X PUT "http://localhost:20128/api/combos/{id}" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

### DELETE

```bash
curl -sS -X DELETE "http://localhost:20128/api/combos/{id}"
```

---

## `/api/combos`

**File:** `src/app/api/combos/route.js`

**What it does:** Validate combo name: only a-z, A-Z, 0-9, -, _

**Methods:** GET, POST

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/combos"
```

### POST

**Example curl (`/api/combos`):**

```bash
curl -sS -X POST "http://localhost:20128/api/combos" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/health`

**File:** `src/app/api/health/route.js`

**What it does:** HTTP handler for `/api/health`. See source: `src/app/api/health/route.js`.

**Methods:** GET

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/health"
```

---

## `/api/init`

**File:** `src/app/api/init/route.js`

**What it does:** Auto-initialize cloud sync when server starts

**Methods:** GET

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/init"
```

---

## `/api/keys/{id}`

**File:** `src/app/api/keys/[id]/route.js`

**What it does:** GET /api/keys/[id] - Get single key

**Methods:** GET, PUT, DELETE

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/keys/{id}"
```

### PUT

**Example curl (`/api/keys/{id}`):**

```bash
curl -sS -X PUT "http://localhost:20128/api/keys/{id}" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

### DELETE

```bash
curl -sS -X DELETE "http://localhost:20128/api/keys/{id}"
```

---

## `/api/keys`

**File:** `src/app/api/keys/route.js`

**What it does:** GET /api/keys - List API keys

**Methods:** GET, POST

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/keys"
```

### POST

**Example curl (`/api/keys`):**

```bash
curl -sS -X POST "http://localhost:20128/api/keys" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/locale`

**File:** `src/app/api/locale/route.js`

**What it does:** 1 year

**Methods:** POST

### POST

**Example curl (`/api/locale`):**

```bash
curl -sS -X POST "http://localhost:20128/api/locale" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/mcp/{plugin}/message`

**File:** `src/app/api/mcp/[plugin]/message/route.js`

**What it does:** HTTP handler for `/api/mcp/{plugin}/message`. See source: `src/app/api/mcp/[plugin]/message/route.js`.

**Methods:** POST

### POST

**Example curl (`/api/mcp/{plugin}/message`):**

```bash
curl -sS -X POST "http://localhost:20128/api/mcp/{plugin}/message" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/mcp/{plugin}/sse`

**File:** `src/app/api/mcp/[plugin]/sse/route.js`

**What it does:** MCP SSE handshake: tell client where to POST messages.

**Methods:** GET

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/mcp/{plugin}/sse"
```

---

## `/api/media-providers/tts/deepgram/voices`

**File:** `src/app/api/media-providers/tts/deepgram/voices/route.js`

**What it does:** GET /api/media-providers/tts/deepgram/voices[?lang=en]

**Methods:** GET

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/media-providers/tts/deepgram/voices"
```

---

## `/api/media-providers/tts/elevenlabs/voices`

**File:** `src/app/api/media-providers/tts/elevenlabs/voices/route.js`

**What it does:** GET /api/media-providers/tts/elevenlabs/voices[?lang=en]

**Methods:** GET

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/media-providers/tts/elevenlabs/voices"
```

---

## `/api/media-providers/tts/inworld/voices`

**File:** `src/app/api/media-providers/tts/inworld/voices/route.js`

**What it does:** GET /api/media-providers/tts/inworld/voices[?lang=en]

**Methods:** GET

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/media-providers/tts/inworld/voices"
```

---

## `/api/media-providers/tts/voices`

**File:** `src/app/api/media-providers/tts/voices/route.js`

**What it does:** GET /api/media-providers/tts/voices

**Methods:** GET

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/media-providers/tts/voices"
```

---

## `/api/models/alias`

**File:** `src/app/api/models/alias/route.js`

**What it does:** GET /api/models/alias - Get all aliases

**Methods:** GET, PUT, DELETE

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/models/alias"
```

### PUT

**Example curl (`/api/models/alias`):**

```bash
curl -sS -X PUT "http://localhost:20128/api/models/alias" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

### DELETE

```bash
curl -sS -X DELETE "http://localhost:20128/api/models/alias"
```

---

## `/api/models/availability`

**File:** `src/app/api/models/availability/route.js`

**What it does:** HTTP handler for `/api/models/availability`. See source: `src/app/api/models/availability/route.js`.

**Methods:** GET, POST

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/models/availability"
```

### POST

**Example curl (`/api/models/availability`):**

```bash
curl -sS -X POST "http://localhost:20128/api/models/availability" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/models/custom`

**File:** `src/app/api/models/custom/route.js`

**What it does:** GET /api/models/custom - List all custom models

**Methods:** GET, POST, DELETE

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/models/custom"
```

### POST

**Example curl (`/api/models/custom`):**

```bash
curl -sS -X POST "http://localhost:20128/api/models/custom" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

### DELETE

```bash
curl -sS -X DELETE "http://localhost:20128/api/models/custom"
```

---

## `/api/models/disabled`

**File:** `src/app/api/models/disabled/route.js`

**What it does:** GET /api/models/disabled?providerAlias=xxx

**Methods:** GET, POST, DELETE

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/models/disabled"
```

### POST

**Example curl (`/api/models/disabled`):**

```bash
curl -sS -X POST "http://localhost:20128/api/models/disabled" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

### DELETE

```bash
curl -sS -X DELETE "http://localhost:20128/api/models/disabled"
```

---

## `/api/models`

**File:** `src/app/api/models/route.js`

**What it does:** GET /api/models - Get models with aliases

**Methods:** GET, PUT

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/models"
```

### PUT

**Example curl (`/api/models`):**

```bash
curl -sS -X PUT "http://localhost:20128/api/models" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/models/test`

**File:** `src/app/api/models/test/route.js`

**What it does:** POST /api/models/test - Ping a single model via internal completions or embeddings

**Methods:** POST

### POST

**Example curl (`/api/models/test`):**

```bash
curl -sS -X POST "http://localhost:20128/api/models/test" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/oauth/{provider}/{action}`

**File:** `src/app/api/oauth/[provider]/[action]/route.js`

**What it does:** Dynamic OAuth API Route

**Methods:** GET, POST

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/oauth/{provider}/{action}"
```

### POST

**Example curl (`/api/oauth/{provider}/{action}`):**

```bash
curl -sS -X POST "http://localhost:20128/api/oauth/{provider}/{action}" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/oauth/cursor/auto-import`

**File:** `src/app/api/oauth/cursor/auto-import/route.js`

**What it does:** Get candidate db paths by platform

**Methods:** GET

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/oauth/cursor/auto-import"
```

---

## `/api/oauth/cursor/import`

**File:** `src/app/api/oauth/cursor/import/route.js`

**What it does:** POST /api/oauth/cursor/import

**Methods:** POST, GET

### POST

**Example curl (`/api/oauth/cursor/import`):**

```bash
curl -sS -X POST "http://localhost:20128/api/oauth/cursor/import" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/oauth/cursor/import"
```

---

## `/api/oauth/gitlab/pat`

**File:** `src/app/api/oauth/gitlab/pat/route.js`

**What it does:** POST /api/oauth/gitlab/pat

**Methods:** POST

### POST

**Example curl (`/api/oauth/gitlab/pat`):**

```bash
curl -sS -X POST "http://localhost:20128/api/oauth/gitlab/pat" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/oauth/iflow/cookie`

**File:** `src/app/api/oauth/iflow/cookie/route.js`

**What it does:** iFlow Cookie-Based Authentication

**Methods:** POST

### POST

**Example curl (`/api/oauth/iflow/cookie`):**

```bash
curl -sS -X POST "http://localhost:20128/api/oauth/iflow/cookie" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/oauth/kiro/auto-import`

**File:** `src/app/api/oauth/kiro/auto-import/route.js`

**What it does:** GET /api/oauth/kiro/auto-import

**Methods:** GET

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/oauth/kiro/auto-import"
```

---

## `/api/oauth/kiro/import`

**File:** `src/app/api/oauth/kiro/import/route.js`

**What it does:** POST /api/oauth/kiro/import

**Methods:** POST

### POST

**Example curl (`/api/oauth/kiro/import`):**

```bash
curl -sS -X POST "http://localhost:20128/api/oauth/kiro/import" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/oauth/kiro/social-authorize`

**File:** `src/app/api/oauth/kiro/social-authorize/route.js`

**What it does:** GET /api/oauth/kiro/social-authorize

**Methods:** GET

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/oauth/kiro/social-authorize"
```

---

## `/api/oauth/kiro/social-exchange`

**File:** `src/app/api/oauth/kiro/social-exchange/route.js`

**What it does:** POST /api/oauth/kiro/social-exchange

**Methods:** POST

### POST

**Example curl (`/api/oauth/kiro/social-exchange`):**

```bash
curl -sS -X POST "http://localhost:20128/api/oauth/kiro/social-exchange" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/pricing`

**File:** `src/app/api/pricing/route.js`

**What it does:** GET /api/pricing

**Methods:** GET, PATCH, DELETE

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/pricing"
```

### PATCH

**Example curl (`/api/pricing`):**

```bash
curl -sS -X PATCH "http://localhost:20128/api/pricing" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

### DELETE

```bash
curl -sS -X DELETE "http://localhost:20128/api/pricing"
```

---

## `/api/provider-nodes/{id}`

**File:** `src/app/api/provider-nodes/[id]/route.js`

**What it does:** PUT /api/provider-nodes/[id] - Update provider node

**Methods:** PUT, DELETE

### PUT

**Example curl (`/api/provider-nodes/{id}`):**

```bash
curl -sS -X PUT "http://localhost:20128/api/provider-nodes/{id}" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

### DELETE

```bash
curl -sS -X DELETE "http://localhost:20128/api/provider-nodes/{id}"
```

---

## `/api/provider-nodes`

**File:** `src/app/api/provider-nodes/route.js`

**What it does:** api.openai.com/v1",

**Methods:** GET, POST

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/provider-nodes"
```

### POST

**Example curl (`/api/provider-nodes`):**

```bash
curl -sS -X POST "http://localhost:20128/api/provider-nodes" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/provider-nodes/validate`

**File:** `src/app/api/provider-nodes/validate/route.js`

**What it does:** Fetch with timeout wrapper

**Methods:** POST

### POST

**Example curl (`/api/provider-nodes/validate`):**

```bash
curl -sS -X POST "http://localhost:20128/api/provider-nodes/validate" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/providers/{id}/models`

**File:** `src/app/api/providers/[id]/models/route.js`

**What it does:** GET /api/providers/[id]/models - Get models list from provider

**Methods:** GET

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/providers/{id}/models"
```

---

## `/api/providers/{id}`

**File:** `src/app/api/providers/[id]/route.js`

**What it does:** GET /api/providers/[id] - Get single connection

**Methods:** GET, PUT, DELETE

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/providers/{id}"
```

### PUT

**Example curl (`/api/providers/{id}`):**

```bash
curl -sS -X PUT "http://localhost:20128/api/providers/{id}" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

### DELETE

```bash
curl -sS -X DELETE "http://localhost:20128/api/providers/{id}"
```

---

## `/api/providers/{id}/test-models`

**File:** `src/app/api/providers/[id]/test-models/route.js`

**What it does:** Get an active API key to pass through auth when requireApiKey is enabled.

**Methods:** POST

### POST

**Example curl (`/api/providers/{id}/test-models`):**

```bash
curl -sS -X POST "http://localhost:20128/api/providers/{id}/test-models" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/providers/{id}/test`

**File:** `src/app/api/providers/[id]/test/route.js`

**What it does:** POST /api/providers/[id]/test - Test connection

**Methods:** POST

### POST

**Example curl (`/api/providers/{id}/test`):**

```bash
curl -sS -X POST "http://localhost:20128/api/providers/{id}/test" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/providers/client`

**File:** `src/app/api/providers/client/route.js`

**What it does:** GET /api/providers/client - List all connections for client (includes sensitive fields for sync)

**Methods:** GET

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/providers/client"
```

---

## `/api/providers/kilo/free-models`

**File:** `src/app/api/providers/kilo/free-models/route.js`

**What it does:** api.kilo.ai/api/gateway/models";

**Methods:** GET

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/providers/kilo/free-models"
```

---

## `/api/providers`

**File:** `src/app/api/providers/route.js`

**What it does:** GET /api/providers - List all connections

**Methods:** GET, POST

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/providers"
```

### POST

**Example curl (`/api/providers`):**

```bash
curl -sS -X POST "http://localhost:20128/api/providers" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/providers/suggested-models`

**File:** `src/app/api/providers/suggested-models/route.js`

**What it does:** HTTP handler for `/api/providers/suggested-models`. See source: `src/app/api/providers/suggested-models/route.js`.

**Methods:** GET

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/providers/suggested-models"
```

---

## `/api/providers/test-batch`

**File:** `src/app/api/providers/test-batch/route.js`

**What it does:** Prioritize authType from connection if available

**Methods:** POST

### POST

**Example curl (`/api/providers/test-batch`):**

```bash
curl -sS -X POST "http://localhost:20128/api/providers/test-batch" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/providers/validate`

**File:** `src/app/api/providers/validate/route.js`

**What it does:** Probe a webSearch/webFetch provider using its searchConfig/fetchConfig.

**Methods:** POST

### POST

**Example curl (`/api/providers/validate`):**

```bash
curl -sS -X POST "http://localhost:20128/api/providers/validate" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/proxy-pools/{id}`

**File:** `src/app/api/proxy-pools/[id]/route.js`

**What it does:** GET /api/proxy-pools/[id] - Get proxy pool

**Methods:** GET, PUT, DELETE

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/proxy-pools/{id}"
```

### PUT

**Example curl (`/api/proxy-pools/{id}`):**

```bash
curl -sS -X PUT "http://localhost:20128/api/proxy-pools/{id}" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

### DELETE

```bash
curl -sS -X DELETE "http://localhost:20128/api/proxy-pools/{id}"
```

---

## `/api/proxy-pools/{id}/test`

**File:** `src/app/api/proxy-pools/[id]/test/route.js`

**What it does:** httpbin.org",

**Methods:** POST

### POST

**Example curl (`/api/proxy-pools/{id}/test`):**

```bash
curl -sS -X POST "http://localhost:20128/api/proxy-pools/{id}/test" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/proxy-pools`

**File:** `src/app/api/proxy-pools/route.js`

**What it does:** GET /api/proxy-pools - List proxy pools

**Methods:** GET, POST

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/proxy-pools"
```

### POST

**Example curl (`/api/proxy-pools`):**

```bash
curl -sS -X POST "http://localhost:20128/api/proxy-pools" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/proxy-pools/vercel-deploy`

**File:** `src/app/api/proxy-pools/vercel-deploy/route.js`

**What it does:** api.vercel.com";

**Methods:** POST

### POST

**Example curl (`/api/proxy-pools/vercel-deploy`):**

```bash
curl -sS -X POST "http://localhost:20128/api/proxy-pools/vercel-deploy" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/settings/database`

**File:** `src/app/api/settings/database/route.js`

**What it does:** Ensure proxy settings take effect immediately after a DB import.

**Methods:** GET, POST

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/settings/database"
```

### POST

**Example curl (`/api/settings/database`):**

```bash
curl -sS -X POST "http://localhost:20128/api/settings/database" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/settings/proxy-test`

**File:** `src/app/api/settings/proxy-test/route.js`

**What it does:** HTTP handler for `/api/settings/proxy-test`. See source: `src/app/api/settings/proxy-test/route.js`.

**Methods:** POST

### POST

**Example curl (`/api/settings/proxy-test`):**

```bash
curl -sS -X POST "http://localhost:20128/api/settings/proxy-test" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/settings/require-login`

**File:** `src/app/api/settings/require-login/route.js`

**What it does:** HTTP handler for `/api/settings/require-login`. See source: `src/app/api/settings/require-login/route.js`.

**Methods:** GET

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/settings/require-login"
```

---

## `/api/settings`

**File:** `src/app/api/settings/route.js`

**What it does:** If updating password, hash it

**Methods:** GET, PATCH

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/settings"
```

### PATCH

**Example curl (`/api/settings`):**

```bash
curl -sS -X PATCH "http://localhost:20128/api/settings" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/shutdown`

**File:** `src/app/api/shutdown/route.js`

**What it does:** HTTP handler for `/api/shutdown`. See source: `src/app/api/shutdown/route.js`.

**Methods:** POST

### POST

**Example curl (`/api/shutdown`):**

```bash
curl -sS -X POST "http://localhost:20128/api/shutdown" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/tags`

**File:** `src/app/api/tags/route.js`

**What it does:** HTTP handler for `/api/tags`. See source: `src/app/api/tags/route.js`.

**Methods:** OPTIONS, GET

### OPTIONS

```bash
curl -sS -X OPTIONS "http://localhost:20128/api/tags" -i
```

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/tags"
```

---

## `/api/translator/console-logs`

**File:** `src/app/api/translator/console-logs/route.js`

**What it does:** HTTP handler for `/api/translator/console-logs`. See source: `src/app/api/translator/console-logs/route.js`.

**Methods:** GET, DELETE

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/translator/console-logs"
```

### DELETE

```bash
curl -sS -X DELETE "http://localhost:20128/api/translator/console-logs"
```

---

## `/api/translator/console-logs/stream`

**File:** `src/app/api/translator/console-logs/stream/route.js`

**What it does:** Idempotent: safe to call from request.signal abort, cancel(), or enqueue failure.

**Methods:** GET

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/translator/console-logs/stream"
```

---

## `/api/translator/load`

**File:** `src/app/api/translator/load/route.js`

**What it does:** Security: only allow specific filenames

**Methods:** GET

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/translator/load"
```

---

## `/api/translator/save`

**File:** `src/app/api/translator/save/route.js`

**What it does:** Security: only allow specific filenames

**Methods:** POST

### POST

**Example curl (`/api/translator/save`):**

```bash
curl -sS -X POST "http://localhost:20128/api/translator/save" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/translator/send`

**File:** `src/app/api/translator/send/route.js`

**What it does:** Auto-refresh token on 401/403 and retry (same as chatCore.js)

**Methods:** POST

### POST

**Example curl (`/api/translator/send`):**

```bash
curl -sS -X POST "http://localhost:20128/api/translator/send" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/translator/translate`

**File:** `src/app/api/translator/translate/route.js`

**What it does:** Detect provider + formats from 1_req_client.json

**Methods:** POST

### POST

**Example curl (`/api/translator/translate`):**

```bash
curl -sS -X POST "http://localhost:20128/api/translator/translate" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/tunnel/disable`

**File:** `src/app/api/tunnel/disable/route.js`

**What it does:** HTTP handler for `/api/tunnel/disable`. See source: `src/app/api/tunnel/disable/route.js`.

**Methods:** POST

### POST

**Example curl (`/api/tunnel/disable`):**

```bash
curl -sS -X POST "http://localhost:20128/api/tunnel/disable" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/tunnel/enable`

**File:** `src/app/api/tunnel/enable/route.js`

**What it does:** Wait for DNS warmup to propagate at Cloudflare edge after tunnel registered

**Methods:** POST

### POST

**Example curl (`/api/tunnel/enable`):**

```bash
curl -sS -X POST "http://localhost:20128/api/tunnel/enable" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/tunnel/status`

**File:** `src/app/api/tunnel/status/route.js`

**What it does:** HTTP handler for `/api/tunnel/status`. See source: `src/app/api/tunnel/status/route.js`.

**Methods:** GET

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/tunnel/status"
```

---

## `/api/tunnel/tailscale-check`

**File:** `src/app/api/tunnel/tailscale-check/route.js`

**What it does:** Run independent probes in parallel — none blocks the event loop

**Methods:** GET

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/tunnel/tailscale-check"
```

---

## `/api/tunnel/tailscale-disable`

**File:** `src/app/api/tunnel/tailscale-disable/route.js`

**What it does:** HTTP handler for `/api/tunnel/tailscale-disable`. See source: `src/app/api/tunnel/tailscale-disable/route.js`.

**Methods:** POST

### POST

**Example curl (`/api/tunnel/tailscale-disable`):**

```bash
curl -sS -X POST "http://localhost:20128/api/tunnel/tailscale-disable" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/tunnel/tailscale-enable`

**File:** `src/app/api/tunnel/tailscale-enable/route.js`

**What it does:** HTTP handler for `/api/tunnel/tailscale-enable`. See source: `src/app/api/tunnel/tailscale-enable/route.js`.

**Methods:** POST

### POST

**Example curl (`/api/tunnel/tailscale-enable`):**

```bash
curl -sS -X POST "http://localhost:20128/api/tunnel/tailscale-enable" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/tunnel/tailscale-install`

**File:** `src/app/api/tunnel/tailscale-install/route.js`

**What it does:** HTTP handler for `/api/tunnel/tailscale-install`. See source: `src/app/api/tunnel/tailscale-install/route.js`.

**Methods:** POST

### POST

**Example curl (`/api/tunnel/tailscale-install`):**

```bash
curl -sS -X POST "http://localhost:20128/api/tunnel/tailscale-install" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/tunnel/tailscale-login`

**File:** `src/app/api/tunnel/tailscale-login/route.js`

**What it does:** HTTP handler for `/api/tunnel/tailscale-login`. See source: `src/app/api/tunnel/tailscale-login/route.js`.

**Methods:** POST

### POST

**Example curl (`/api/tunnel/tailscale-login`):**

```bash
curl -sS -X POST "http://localhost:20128/api/tunnel/tailscale-login" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/tunnel/tailscale-start-daemon`

**File:** `src/app/api/tunnel/tailscale-start-daemon/route.js`

**What it does:** Use provided password, or fall back to cached/stored MITM password

**Methods:** POST

### POST

**Example curl (`/api/tunnel/tailscale-start-daemon`):**

```bash
curl -sS -X POST "http://localhost:20128/api/tunnel/tailscale-start-daemon" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/usage/{connectionId}`

**File:** `src/app/api/usage/[connectionId]/route.js`

**What it does:** GET /api/usage/[connectionId] - Get usage data for a specific connection

**Methods:** GET

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/usage/{connectionId}"
```

---

## `/api/usage/chart`

**File:** `src/app/api/usage/chart/route.js`

**What it does:** HTTP handler for `/api/usage/chart`. See source: `src/app/api/usage/chart/route.js`.

**Methods:** GET

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/usage/chart"
```

---

## `/api/usage/history`

**File:** `src/app/api/usage/history/route.js`

**What it does:** HTTP handler for `/api/usage/history`. See source: `src/app/api/usage/history/route.js`.

**Methods:** GET

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/usage/history"
```

---

## `/api/usage/logs`

**File:** `src/app/api/usage/logs/route.js`

**What it does:** HTTP handler for `/api/usage/logs`. See source: `src/app/api/usage/logs/route.js`.

**Methods:** GET

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/usage/logs"
```

---

## `/api/usage/providers`

**File:** `src/app/api/usage/providers/route.js`

**What it does:** GET /api/usage/providers

**Methods:** GET

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/usage/providers"
```

---

## `/api/usage/request-details`

**File:** `src/app/api/usage/request-details/route.js`

**What it does:** GET /api/usage/request-details

**Methods:** GET

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/usage/request-details"
```

---

## `/api/usage/request-logs`

**File:** `src/app/api/usage/request-logs/route.js`

**What it does:** HTTP handler for `/api/usage/request-logs`. See source: `src/app/api/usage/request-logs/route.js`.

**Methods:** GET

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/usage/request-logs"
```

---

## `/api/usage/stats`

**File:** `src/app/api/usage/stats/route.js`

**What it does:** HTTP handler for `/api/usage/stats`. See source: `src/app/api/usage/stats/route.js`.

**Methods:** GET

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/usage/stats"
```

---

## `/api/usage/stream`

**File:** `src/app/api/usage/stream/route.js`

**What it does:** Full stats refresh (heavy) + immediate lightweight push

**Methods:** GET

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/usage/stream"
```

---

## `/api/v1/api/chat`

**Also reachable as:** `/v1/api/chat` (same handler)

**File:** `src/app/api/v1/api/chat/route.js`

**What it does:** HTTP handler for `/api/v1/api/chat`. See source: `src/app/api/v1/api/chat/route.js`.

**Methods:** OPTIONS, POST

### OPTIONS

```bash
curl -sS -X OPTIONS "http://localhost:20128/api/v1/api/chat" -i
```

### POST

**Example curl (`/api/v1/api/chat`):**

```bash
curl -sS -X POST "http://localhost:20128/api/v1/api/chat" -H "Content-Type: application/json" --data-raw '{"model":"llama3.2","messages":[{"role":"user","content":"Hi"}]}'
```

**Public path alias:** use `/v1/api/chat` instead of `/api/v1/api/chat` in the URLs above where applicable.

---

## `/api/v1/audio/speech`

**Also reachable as:** `/v1/audio/speech` (same handler)

**File:** `src/app/api/v1/audio/speech/route.js`

**What it does:** POST /v1/audio/speech - OpenAI-compatible TTS endpoint

**Methods:** OPTIONS, POST

### OPTIONS

```bash
curl -sS -X OPTIONS "http://localhost:20128/api/v1/audio/speech" -i
```

### POST

**Example curl (`/api/v1/audio/speech`):**

```bash
curl -sS -X POST "http://localhost:20128/api/v1/audio/speech" -H "Content-Type: application/json" --data-raw '{"model":"tts-1","input":"Hello","voice":"alloy"}'
```

**Public path alias:** use `/v1/audio/speech` instead of `/api/v1/audio/speech` in the URLs above where applicable.

---

## `/api/v1/audio/transcriptions`

**Also reachable as:** `/v1/audio/transcriptions` (same handler)

**File:** `src/app/api/v1/audio/transcriptions/route.js`

**What it does:** POST /v1/audio/transcriptions - OpenAI Whisper compatible STT

**Methods:** OPTIONS, POST

### OPTIONS

```bash
curl -sS -X OPTIONS "http://localhost:20128/api/v1/audio/transcriptions" -i
```

### POST

**Example curl (`/api/v1/audio/transcriptions`):**

```bash
curl -sS -X POST "http://localhost:20128/api/v1/audio/transcriptions" -F "file=@./recording.wav" -F "model=whisper-1"
```

**Public path alias:** use `/v1/audio/transcriptions` instead of `/api/v1/audio/transcriptions` in the URLs above where applicable.

---

## `/api/v1/audio/voices`

**Also reachable as:** `/v1/audio/voices` (same handler)

**File:** `src/app/api/v1/audio/voices/route.js`

**What it does:** Provider → internal voices API. Edge/local-device share the generic endpoint.

**Methods:** OPTIONS, GET

### OPTIONS

```bash
curl -sS -X OPTIONS "http://localhost:20128/api/v1/audio/voices" -i
```

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/v1/audio/voices"
```

**Public path alias:** use `/v1/audio/voices` instead of `/api/v1/audio/voices` in the URLs above where applicable.

---

## `/api/v1/chat/completions`

**Also reachable as:** `/v1/chat/completions` (same handler)

**File:** `src/app/api/v1/chat/completions/route.js`

**What it does:** Initialize translators once

**Methods:** OPTIONS, POST

### OPTIONS

```bash
curl -sS -X OPTIONS "http://localhost:20128/api/v1/chat/completions" -i
```

### POST

**Example curl (`/api/v1/chat/completions`):**

```bash
curl -sS -X POST "http://localhost:20128/api/v1/chat/completions" -H "Content-Type: application/json" --data-raw '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Hi"}]}'
```

**Public path alias:** use `/v1/chat/completions` instead of `/api/v1/chat/completions` in the URLs above where applicable.

---

## `/api/v1/embeddings`

**Also reachable as:** `/v1/embeddings` (same handler)

**File:** `src/app/api/v1/embeddings/route.js`

**What it does:** POST /v1/embeddings - OpenAI-compatible embeddings endpoint

**Methods:** OPTIONS, POST

### OPTIONS

```bash
curl -sS -X OPTIONS "http://localhost:20128/api/v1/embeddings" -i
```

### POST

**Example curl (`/api/v1/embeddings`):**

```bash
curl -sS -X POST "http://localhost:20128/api/v1/embeddings" -H "Content-Type: application/json" --data-raw '{"model":"text-embedding-3-small","input":"hello world"}'
```

**Public path alias:** use `/v1/embeddings` instead of `/api/v1/embeddings` in the URLs above where applicable.

---

## `/api/v1/images/generations`

**Also reachable as:** `/v1/images/generations` (same handler)

**File:** `src/app/api/v1/images/generations/route.js`

**What it does:** POST /v1/images/generations - OpenAI-compatible image generation endpoint

**Methods:** OPTIONS, POST

### OPTIONS

```bash
curl -sS -X OPTIONS "http://localhost:20128/api/v1/images/generations" -i
```

### POST

**Example curl (`/api/v1/images/generations`):**

```bash
curl -sS -X POST "http://localhost:20128/api/v1/images/generations" -H "Content-Type: application/json" --data-raw '{"model":"dall-e-3","prompt":"A red circle","n":1,"size":"1024x1024"}'
```

**Public path alias:** use `/v1/images/generations` instead of `/api/v1/images/generations` in the URLs above where applicable.

---

## `/api/v1/messages/count_tokens`

**Also reachable as:** `/v1/messages/count_tokens` (same handler)

**File:** `src/app/api/v1/messages/count_tokens/route.js`

**What it does:** POST /v1/messages/count_tokens - Mock token count response

**Methods:** OPTIONS, POST

### OPTIONS

```bash
curl -sS -X OPTIONS "http://localhost:20128/api/v1/messages/count_tokens" -i
```

### POST

**Example curl (`/api/v1/messages/count_tokens`):**

```bash
curl -sS -X POST "http://localhost:20128/api/v1/messages/count_tokens" -H "Content-Type: application/json" --data-raw '{"messages":[{"role":"user","content":"Hello"}]}'
```

**Public path alias:** use `/v1/messages/count_tokens` instead of `/api/v1/messages/count_tokens` in the URLs above where applicable.

---

## `/api/v1/messages`

**Also reachable as:** `/v1/messages` (same handler)

**File:** `src/app/api/v1/messages/route.js`

**What it does:** POST /v1/messages - Claude format (auto convert via handleChat)

**Methods:** OPTIONS, POST

### OPTIONS

```bash
curl -sS -X OPTIONS "http://localhost:20128/api/v1/messages" -i
```

### POST

**Example curl (`/api/v1/messages`):**

```bash
curl -sS -X POST "http://localhost:20128/api/v1/messages" -H "Content-Type: application/json" --data-raw '{"model":"claude-sonnet-4-20250514","max_tokens":256,"messages":[{"role":"user","content":"Hi"}]}'
```

**Public path alias:** use `/v1/messages` instead of `/api/v1/messages` in the URLs above where applicable.

---

## `/api/v1/models/{kind}`

**Also reachable as:** `/v1/models/{kind}` (same handler)

**File:** `src/app/api/v1/models/[kind]/route.js`

**What it does:** GET /v1/models/{kind} - OpenAI-compatible models list filtered by capability.

**Methods:** OPTIONS, GET

### OPTIONS

```bash
curl -sS -X OPTIONS "http://localhost:20128/api/v1/models/{kind}" -i
```

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/v1/models/{kind}"
```

**Public path alias:** use `/v1/models/{kind}` instead of `/api/v1/models/{kind}` in the URLs above where applicable.

---

## `/api/v1/models/info`

**Also reachable as:** `/v1/models/info` (same handler)

**File:** `src/app/api/v1/models/info/route.js`

**What it does:** id format: "{alias}/{modelId}" - alias may also be providerId

**Methods:** OPTIONS, GET

### OPTIONS

```bash
curl -sS -X OPTIONS "http://localhost:20128/api/v1/models/info" -i
```

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/v1/models/info"
```

**Public path alias:** use `/v1/models/info` instead of `/api/v1/models/info` in the URLs above where applicable.

---

## `/api/v1/models`

**Also reachable as:** `/v1/models` (same handler)

**File:** `src/app/api/v1/models/route.js`

**What it does:** GET /v1/models - OpenAI compatible models list (LLM/chat models only by default).

**Methods:** OPTIONS, GET

### OPTIONS

```bash
curl -sS -X OPTIONS "http://localhost:20128/api/v1/models" -i
```

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/v1/models"
```

**Public path alias:** use `/v1/models` instead of `/api/v1/models` in the URLs above where applicable.

---

## `/api/v1/responses/compact`

**Also reachable as:** `/v1/responses/compact` (same handler)

**File:** `src/app/api/v1/responses/compact/route.js`

**What it does:** POST /v1/responses/compact - Compact conversation context

**Methods:** OPTIONS, POST

### OPTIONS

```bash
curl -sS -X OPTIONS "http://localhost:20128/api/v1/responses/compact" -i
```

### POST

**Example curl (`/api/v1/responses/compact`):**

```bash
curl -sS -X POST "http://localhost:20128/api/v1/responses/compact" -H "Content-Type: application/json" --data-raw '{"model":"gpt-4o","input":[{"role":"user","content":"Hi"}]}'
```

**Public path alias:** use `/v1/responses/compact` instead of `/api/v1/responses/compact` in the URLs above where applicable.

---

## `/api/v1/responses`

**Also reachable as:** `/v1/responses` (same handler)

**File:** `src/app/api/v1/responses/route.js`

**What it does:** POST /v1/responses - OpenAI Responses API format

**Methods:** OPTIONS, POST

### OPTIONS

```bash
curl -sS -X OPTIONS "http://localhost:20128/api/v1/responses" -i
```

### POST

**Example curl (`/api/v1/responses`):**

```bash
curl -sS -X POST "http://localhost:20128/api/v1/responses" -H "Content-Type: application/json" --data-raw '{"model":"gpt-4o","input":"Why is the sky blue?"}'
```

**Public path alias:** use `/v1/responses` instead of `/api/v1/responses` in the URLs above where applicable.

---

## `/api/v1/search`

**Also reachable as:** `/v1/search` (same handler)

**File:** `src/app/api/v1/search/route.js`

**What it does:** POST /v1/search - Web search endpoint

**Methods:** OPTIONS, POST

### OPTIONS

```bash
curl -sS -X OPTIONS "http://localhost:20128/api/v1/search" -i
```

### POST

**Example curl (`/api/v1/search`):**

```bash
curl -sS -X POST "http://localhost:20128/api/v1/search" -H "Content-Type: application/json" --data-raw '{"model":"tavily/search","query":"ebRouter","max_results":5}'
```

**Public path alias:** use `/v1/search` instead of `/api/v1/search` in the URLs above where applicable.

---

## `/api/v1/web/fetch`

**Also reachable as:** `/v1/web/fetch` (same handler)

**File:** `src/app/api/v1/web/fetch/route.js`

**What it does:** POST /v1/web/fetch - Web URL fetch/extract endpoint

**Methods:** OPTIONS, POST

### OPTIONS

```bash
curl -sS -X OPTIONS "http://localhost:20128/api/v1/web/fetch" -i
```

### POST

**Example curl (`/api/v1/web/fetch`):**

```bash
curl -sS -X POST "http://localhost:20128/api/v1/web/fetch" -H "Content-Type: application/json" --data-raw '{"model":"jina/reader","url":"https://example.com"}'
```

**Public path alias:** use `/v1/web/fetch` instead of `/api/v1/web/fetch` in the URLs above where applicable.

---

## `/api/v1beta/models/{...path}`

**Also reachable as:** `/v1beta/models/{...path}` (same handler)

**File:** `src/app/api/v1beta/models/[...path]/route.js`

**What it does:** POST /v1beta/models/{model}:generateContent        — non-streaming

**Methods:** OPTIONS, POST

### OPTIONS

```bash
curl -sS -X OPTIONS "http://localhost:20128/api/v1beta/models/{...path}" -i
```

### POST

**Example curl (`/api/v1beta/models/{...path}`):**

```bash
curl -sS -X POST "http://localhost:20128/api/v1beta/models/{...path}" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

**Public path alias:** use `/v1beta/models/{...path}` instead of `/api/v1beta/models/{...path}` in the URLs above where applicable.

---

## `/api/v1beta/models`

**Also reachable as:** `/v1beta/models` (same handler)

**File:** `src/app/api/v1beta/models/route.js`

**What it does:** GET /v1beta/models - Gemini compatible models list

**Methods:** OPTIONS, GET

### OPTIONS

```bash
curl -sS -X OPTIONS "http://localhost:20128/api/v1beta/models" -i
```

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/v1beta/models"
```

**Public path alias:** use `/v1beta/models` instead of `/api/v1beta/models` in the URLs above where applicable.

---

## `/api/version`

**File:** `src/app/api/version/route.js`

**What it does:** Fetch latest version from npm registry

**Methods:** GET

### GET

```bash
curl -sS -X GET "http://localhost:20128/api/version"
```

---

## `/api/version/shutdown`

**File:** `src/app/api/version/shutdown/route.js`

**What it does:** Shutdown app to release file locks for manual update

**Methods:** POST

### POST

**Example curl (`/api/version/shutdown`):**

```bash
curl -sS -X POST "http://localhost:20128/api/version/shutdown" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

## `/api/version/update`

**File:** `src/app/api/version/update/route.js`

**What it does:** Kill sibling processes (cloudflared, MITM, stray next-server) to release file locks on Windows

**Methods:** POST

### POST

**Example curl (`/api/version/update`):**

```bash
curl -sS -X POST "http://localhost:20128/api/version/update" -H "Content-Type: application/json" --data-raw '{}'
```

*inspect route for required JSON fields*

---

