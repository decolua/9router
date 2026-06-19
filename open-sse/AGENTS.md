# open-sse

Provider-agnostic SSE engine: one OpenAI-style request → any provider (LLM chat, image, embedding, tts, stt, search), streamed back in the client's format.

## Request lifecycle (chat)

`handlers/chatCore.js` → `services/model.js` `parseModel` (resolve `provider/model`) → `executors/index.js` `getExecutor(provider)` → `translator/index.js` `translateRequest` (client format → provider format) → `executor.execute()` (streams upstream) → `translateResponse` (provider chunks → client format) → SSE out.

## Directory map

- `config/` — ALL constants/config (no hardcode elsewhere). `providers.js`/`registry/` (provider defs), `providerModels.js` (alias→models matrix), `runtimeConfig.js` (timeouts, token limits), `*Constants.js`.
- `translator/` — format conversion. `request/<from>-to-<to>.js`, `response/<from>-to-<to>.js`, `schema/` (enums: ROLE, CLAUDE_BLOCK…), `concerns/` (shared logic), `formats/` (per-format). See `tests/translator/AGENTS.md`.
- `executors/` — per-provider upstream call. `base.js` (BaseExecutor), one file per special provider, `index.js` map.
- `providers/` — registry build + `capabilities.js` + `pricing.js`. Entry: `index.js` (PROVIDERS).
- `handlers/` — per-modality cores (chat/image/embedding/tts/stt/search) + sub-provider folders.
- `services/` — `tokenRefresh/`, `usage/`, `combo.js`, `accountFallback.js`, `modelFallback.js` (per-model primary→fallback hop), `model.js`.
- `utils/` — streamHandler, error, sessionManager, claudeCloaking.

## Conventions

- Config-driven, DRY, camelCase. NEVER hardcode values, models, or block/role strings — use `config/` + `schema/` constants.
- Translator pipeline pivots through OpenAI as the intermediate format. A translator registered on the exact `source:target` pair (e.g. `claude:kiro`) runs as a **direct route**, skipping the lossy double-hop.
- Translators self-register via `register(from, to, reqFn, resFn)` as an import side-effect — new files MUST be imported in `translator/index.js`.

## How to add

- **Provider**: copy `providers/REGISTRY_TEMPLATE.js` → `providers/registry/{id}.js`; add models to `config/providerModels.js`. Generic providers need no executor (DefaultExecutor handles OpenAI-compatible APIs).
- **Executor** (only for non-standard upstream): subclass `BaseExecutor` (override `getBaseUrls`/`buildHeaders`/`buildUrl`/`execute`), register in `executors/index.js` map. `getExecutor` falls back to `DefaultExecutor` when absent.
- **Translator**: add `request|response/<from>-to-<to>.js` calling `register(...)`, then import it in `translator/index.js`. Reuse `schema/` + `concerns/` — don't re-implement parsing.

## Pitfalls

- OpenAI bridge is lossy (thinking, non-base64 images, tool ids, is_error) — prefer a direct route for fragile pairs.
- `registry/index.js` is an auto-generated static import list; regenerate it (don't hand-edit) after adding a `registry/{id}.js`. REGISTRY_TEMPLATE is excluded by design.
- Per-model fallback (`runWithModelFallback` in `services/modelFallback.js`) wraps ONLY the direct single-model dispatch at each handler's entry (`handleChat`, `handleFetch`, `handleSearch`, `handleImageGeneration`, `handleTts`, `handleStt`, `handleEmbeddings`). Combos call the handler's `handleSingleModel*` directly and bypass per-model fallback by design — combos already have their own fallback semantics. The wrapper skips the hop on 2xx (streaming-safe) and on deterministic payload errors (`isDeterministicPayloadError`: context-length / too-many-tokens); every other non-2xx is eligible. One hop only — no chaining.
