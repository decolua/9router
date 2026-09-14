# ChatGPT / Codex integration

The **ChatGPT** dashboard section adds up to five 9router models or combos to the
native Codex model picker. It works with the Codex desktop app and CLI using the
normal configuration, without a separate Codex profile.

## Enable

1. In **ChatGPT**, choose models and click **Save models**.
2. Sign in to Codex with the usual ChatGPT account. An existing OpenAI API-key
   login is also supported; it retains API billing rather than subscription billing.
3. Run the install command shown on the page **on the computer running Codex**.
   The installer requires macOS and Node.js 24.5 or newer. It reads a 9router API
   key from `ROUTER9_API_KEY` or a hidden terminal prompt. Keys can be managed on
   **Endpoint & Key**. The downloadable installer can be inspected before running.
   At `9router API key (hidden):`, paste the key and press Enter; characters and
   asterisks are not displayed. If `ROUTER9_API_KEY` is already set, or the helper
   has a saved key for the same endpoint, no prompt appears. The installer prints
   which source it used, without printing the key. Do not put a key in the URL.
4. Quit and reopen Codex. Router entries have IDs such as
   `9router/glm/glm-5.3`; native entries keep their existing IDs and metadata.

The installer is `public/9router-codex.mjs`. When downloaded manually:

```sh
node ./9router-codex.mjs enable --url https://your-router/api/chatgpt/v1
```

The default local port is **20130**, separate from the router's 20128 service and
20129 status service. Override it with `--port 20131` if needed.

If an older copied command leaves zsh at `subsh>`, press **Ctrl+C**, refresh the
dashboard and copy the command again. The space before its final `)` is required
for shells using `url-quote-magic`, which can otherwise paste it as `\)`.

## Update, status, disable

After changing the model selection, save it in the dashboard, then run:

```sh
node "$HOME/.codex/9router-chatgpt/bridge.mjs" sync
```

Restart Codex after syncing; the model catalog is loaded at startup.

```sh
node "$HOME/.codex/9router-chatgpt/bridge.mjs" status
node "$HOME/.codex/9router-chatgpt/bridge.mjs" disable
```

To enter a different key, overriding both the environment and the saved key:

```sh
node "$HOME/.codex/9router-chatgpt/bridge.mjs" enable --ask-api-key
```

Restart Codex after disabling. Re-run `enable` to connect again. For a custom
Codex home, use the helper in that directory and pass `--codex-home /path/to/home`
to every command. `CODEX_HOME` is respected when already set.

## Routing and credentials

```text
Codex → local 127.0.0.1 helper
          ├─ native model + ChatGPT account → chatgpt.com/backend-api/codex
          ├─ native model + OpenAI API key → api.openai.com/v1
          └─ 9router/model → your-router/api/chatgpt/v1 → existing provider pipeline
```

The remote router receives only its own API key. The helper constructs fresh
headers for that route. Native Authorization and ChatGPT-Account-ID headers go
only to the fixed OpenAI endpoints, and redirects are not followed. Incoming
cookies are discarded. No native token is read from or written to `auth.json`.

`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` and their lowercase counterparts are
captured when enabling the helper, so it can use the same explicit HTTP proxies
as the terminal. Re-run `enable` after changing them; `NO_PROXY=*` selects direct
connections. VPN routing at the OS level continues to apply. SOCKS-only proxies
and macOS PAC/system-proxy discovery are not implemented by the helper.

The helper is a user launch agent and starts when the user signs in to macOS. It
accepts only loopback HTTP clients on a random per-install path, rejects browser
Origin headers and answers WebSocket upgrades with 426 so Codex uses HTTP/SSE.
Compressed request decoding is bounded to 64 MiB. SSE backpressure and client
cancellation propagate upstream; native response bodies and status codes pass
through unchanged.

Native requests do not depend on the availability of the remote 9router server
or its model catalog. They do require the local helper while integration is
enabled. If it stops, run `enable` to repair it or `disable` and restart Codex to
restore the preceding connection configuration.

Native auxiliary GET/POST endpoints, including hosted tools, retain the fixed
OpenAI destination, original authorization, query string and encoded request
body. Only Responses requests with a selected `9router/` model go to the router.

## Files and restoration

The helper changes root `model_provider`, `openai_base_url`, and
`model_catalog_json` in Codex's `config.toml`. It sets the built-in provider to
`openai`, retains a valid native default model, and writes a merged catalog under
`9router-chatgpt/`. It does not replace the whole TOML document.

That directory has mode 0700; its state, catalog, helper and backup files have
mode 0600. `state.json` stores the 9router key, proxy settings, original config
entries, local endpoint and launch-agent identity. `config-before-enable.toml`
is the original full backup for manual recovery. Repeated enables preserve the
original baseline. Setup operations are serialized by `operation.lock`.

Disable restores only the integration-owned settings, retaining unrelated
subsequent edits. It also restores the original model when the current default
is a router model. If CC Switch, Ollama or another tool has changed the same
connection keys, the helper reports a conflict instead of overwriting them.
Resolve those keys using the saved original entries before retrying. Never
overwrite the whole live config with an old backup if other settings have changed.

## Server API and compatibility

- `GET /api/chatgpt`: dashboard selection and available LLM models.
- `PUT /api/chatgpt`: validate and save `{ "models": ["provider/model", "Combo"] }`.
- `GET /api/chatgpt/v1/models`: versioned integration manifest for the helper.
- `POST /api/chatgpt/v1/responses`: allowlisted router model → existing `handleChat`.
  Codex v2 requests ending in `compaction_trigger` invoke compaction through this
  same endpoint and return a completed `compaction` item over SSE.
- `POST /api/chatgpt/v1/responses/compact`: summarize with the selected router
  model and return a `compaction` item in a `response.compaction` JSON envelope
  for clients using the legacy protocol.

Management routes use the existing dashboard authentication. Data endpoints
always require an active 9router API key, including on loopback and when general
API-key enforcement is disabled. Namespacing prevents a router model with a
native-looking ID from overriding subscription routing.

Compaction summarizes the conversation with the selected router model and seals
the summary as 9router's own AES-GCM state in `encrypted_content`. The adapter
restores this summary before translating the next request or compacting again.
Decoded summaries use plain assistant text so Chat-compatible providers do not
discard them as unsupported assistant content arrays. Native Gemini/Antigravity
and Claude JSON responses complete both translation stages into Responses output.
The key is derived from the authenticated 9router API key, so the state survives
server and Codex restarts without a server-side conversation database. **Keep the
same router API key to continue a compacted task.** A different key cannot decrypt
its summary. This state is separate from native OpenAI encrypted content.

Codex v2 requires exactly one `response.output_item.done` containing a
`compaction` item, followed by `response.completed` with complete usage counters.
The Chat Completions translator also waits for trailing usage chunks before
completing a normal response, allowing Codex to trigger automatic compaction
from the reported context usage.
Large histories are summarized in chronological parts, then those summaries are
reduced to a single handoff. Each part uses a conservative UTF-8 byte budget
within the saved model context limit (at most 256 KiB), with at most two requests
in flight and up to 8,192 output tokens for supported contexts. This also handles
a single oversized tool result; it does not discard the oldest turns. Opaque
reasoning and binary attachment payloads are replaced by explicit placeholders
while surrounding text is retained. If an HTTP 200 response is truncated or has
no complete assistant text, only that part is split into smaller chronological
fragments (at most four levels) and retried. Provider HTTP errors, persistent
incomplete output and non-reducing summaries abort the entire operation without
replacing history. The selected route and its ordinary Combo fallback apply to
every part; native subscription routes are unaffected.

For large streaming v2 requests, SSE heartbeats keep the bridge and Codex
connection alive while summaries are generated (bounded to 20 minutes). A
failure after headers is reported as `response.failed`, with no compaction item.
Small histories retain the single-request HTTP error behavior. Multi-part
compaction uses more inference calls and its quality still depends on the model;
the non-streaming legacy endpoint remains subject to client/proxy timeouts.
Returning an ordinary assistant message causes `expected exactly one compaction
output item, got 0`. A summary that remains empty or incomplete after bounded
retries returns an error before replacing history. A new task is recommended when changing providers:
encrypted reasoning and opaque response IDs
from one backend are not portable to another. Requests containing
`previous_response_id` or `item_reference` are rejected with an actionable error.
Model quality and tool reliability still depend on the selected upstream. Models
explicitly declaring no tool support cannot be selected. Unknown context limits
use a conservative 32,768-token catalog entry; known limits come from `/v1/models`.

Native catalog entries remain intact, including reasoning levels and service
tiers. Added entries expose the provider's supported reasoning levels; Combos
use the intersection across all members, including nested Combos and aliases.
Fixed reasoning suffixes and routes with no shared levels do not offer a picker.
Binary reasoning uses `none` / `high` (off / on). The manifest refreshes metadata
for existing selections, so another Save is not required. To upgrade an older
helper, run the dashboard install command again; it keeps the saved key and
original configuration backup and refreshes the catalog. `sync` alone refreshes
models without upgrading the installed helper. Restart Codex after the update.
Entries retain generic tool metadata
and no native-only speed tiers or built-in search capability.

GLM-5.3 and GLM-5.3-FLASH support `low`, `high`, and `max`; disabling reasoning is
not supported by the native Z.AI API. See [Z.AI thinking documentation](https://docs.z.ai/guides/capabilities/thinking).

## Verification

```sh
./tests/node_modules/.bin/vitest run --config tests/vitest.config.js \
  tests/unit/chatgpt-bridge.test.js tests/unit/chatgpt-integration.test.js \
  tests/unit/chatgpt-compaction.test.js tests/unit/chatgpt-reasoning.test.js \
  tests/unit/dashboard-guard.test.js
```

For end-to-end verification, run a build with a **disposable DATA_DIR** on a
separate loopback port, set `INITIAL_PASSWORD`, then run:

```sh
CHATGPT_QA_PASSWORD=your-test-password node scripts/test-chatgpt-integration.mjs \
  http://127.0.0.1:20237 --disposable --check-codex --check-installer
```

This creates temporary provider and key fixtures in that database. It covers the
built server, actual Responses translator, streaming tools, continuation,
legacy/v2 compaction, and the downloaded macOS installer's real launchd lifecycle using a
temporary Codex home. It never installs over the user's real Codex config.

`--check-codex` uses Codex CLI 0.154.0's actual app-server in a separate temporary
`CODEX_HOME` with fake authentication and fixture inference. It checks manual,
repeated and automatic compaction, restarts app-server, resumes the saved task
and continues. Set `CHATGPT_QA_CODEX` if the executable is not on PATH. These tests
do not establish generation quality for every real provider or production deployment.

## Reference behavior

- [Ollama's Codex integration](https://docs.ollama.com/integrations/codex-app)
- [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
- [Codex 0.154 compact response parser](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/codex-api/src/endpoint/compact.rs)
- [Codex 0.154 compaction v2 validation](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/compact_remote_v2.rs)
- [Node.js HTTP proxy support](https://nodejs.org/api/http.html#built-in-proxy-support)
