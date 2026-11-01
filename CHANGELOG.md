# Unreleased

## Features
- **Cursor**: browser login (same deep-control flow as the Cursor CLI) so each connection gets its own machine ID. A second account no longer shares the IDE machine ID, which Cursor answers with an empty AgentService turn
- **Cursor**: refresh the static fallback catalog to the current GetUsableModels list (Composer 2.5, Claude 5.x / Fable, GPT-5.6, Grok 4.7, Gemini 4 Argon, and effort tiers)

## Fixes
- **Cursor**: send GetUsableModels through the proxy already configured on that connection (same path as chat). Accounts with no proxy still connect directly; a direct socket is what Cursor geo-blocks with 403

# v0.5.112 (2026-10-28)

## Features
- **MiniMax Code**: add lease auth mode that rides the desktop app's sign-in through a named-pipe/unix-socket broker (length-prefixed JSON protocol, broker-owned token refresh — no refresh token held locally since MiniMax tokens are single-use), with a dashboard lease button and usage attribution
- **Nace Drex**: add the `nace` provider to the System One lane with `drex`, `drex-v2.0` and `drex-max`
- **CommandCode**: align request headers with the official CLI 1.88.0 through a shared `commandCodeHeaders` service
- **Codex**: add `gpt-6.1-terra` (responses-lite lane, GPT-6-Lite thinking levels)

## Fixes
- **NVIDIA NIM**: normalize assistant `reasoning` aliases to `reasoning_content` before forwarding, avoiding NIM's duplicate-field 400 when clients send both.
- **Lazy Runtime**: make the on-demand wreq-js/playwright-core installer work inside published builds — fetch `createRequire` at runtime instead of the bundler-stubbed static import, mark the runtime-dir `import()` calls `webpackIgnore` so file URLs are not captured as bundle chunks, anchor npm to the runtime dir with a minimal `package.json`, and wipe + reinstall once when npm exits 0 on a partially-extracted package (#5245)
- **Docker**: bake `wreq-js` and `playwright-core` into the runner image's `node_modules` (builder-stage isolated install) so OpenCode Free resolves without runtime downloads (#5245)
- **Chat**: surface upstream SSE `error` frames in non-streaming responses — answer with the upstream status (4xx/5xx) and message instead of swallowing them into a generic 502
- **Translator**: enforce Gemini protobuf type predicates on schema `items` and `properties` instead of forwarding shapes the upstream would silently mistype
- **Providers**: keep full `LLM|id|secret` (Muse) key strings opaque in bulk-add instead of splitting on the first pipe into name/key, auto-naming them LLM 1, LLM 2, …
- **DeepSeek**: replace the vendored PoW hash implementation with a noble-hashes keccak port (DeepSeekHashV1, SHA3-256 with round 0 skipped), shrinking `deepseek-pow-hash.js` by ~430 lines
- **GitHub Copilot**: apply Claude 5.5 thinking rules to Copilot's dotted model ids (`claude-opus-5.5*`, `claude-sonnet-5.5`) and make `claude-haiku-5.5` adaptive-only on its Anthropic-native shim, whose budget-shaped thinking comes back 400

# v0.5.111 (2026-10-26)

## Features
- **Ollama**: add `ollama-local` TTS provider serving the Phonon family (15 tags, 38 preset voices), normalizing the requested format to wav/pcm, falling back to an installed tag and the `default` voice, and wrapping raw PCM in a WAV header so the dashboard can preview it
- **Ollama**: add `ollama-local` embedding adapter for `/v1/embeddings`, normalizing a saved host that carries a `/v1` or `/v1/embeddings` suffix and sending a bearer token only when an API key is configured; catalog the 14 embedding model families with their dimensions
- **Providers**: add Runcrate (`rc`) — OpenAI-compatible upstream serving DeepSeek, GLM, Qwen and gpt-oss models, validated through `GET /api/v1/billing/balance` because the public `/v1/models` answers 200 for any key
- **CommandCode**: add Kimi K3.1 Pro to the catalog with the upstream id kept verbatim, riding the existing NDJSON `/alpha/generate` lane
- **OpenCode Go**: add Kimi K3.1 Pro on the chat lane with vision/video input, 1,048,576 context, 131,072 max output and dedicated K3 pricing

## Fixes
- **CLI Tools**: stop the Pi card from resetting every `contextWindow`/`maxTokens` in `~/.pi/agent/models.json` on Apply, add per-model context-window and max-output selectors, and sanitize corrupt cap values instead of writing them back
- **CLI Tools**: treat `name === id` as unset on Apply so a hand-edited Pi model label is no longer overwritten
- **OpenCode**: normalize a caller tool that collides with the OpenCode fingerprint in place (keeping the caller's name and adopting the fingerprint schema) instead of aliasing it to `<name>_client` and restoring it on the response (#4971, #5011)
