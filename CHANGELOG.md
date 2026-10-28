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
- **OpenCode Free**: restore the free tier by sending the TLS ClientHello the upstream accepts (via optional `wreq-js`, fail-open to native fetch), minting session ids from the current time instead of a sha256 digest, and always pairing the CLI `<env>` system marker with a declared tool list
- **OpenCode Free**: cap the published context window of `oc/deepseek-v4.1-flash-free` at 330k so clients compact before the backend's limit (#5097)
- **Translator**: convert `image_url` parts inside `role:"tool"` messages to Claude image blocks instead of forwarding them verbatim and failing with a 400 (#5125)
- **Headroom**: compress only text leaves and copy them back into the original fields, preserving native Claude documents, tool-use ids/inputs, tool results, signed thinking, citations and cache controls (#4670)
- **DeepSeek**: send `deepseek-flash` upstream for `deepseek-v4.1-flash`, whose catalog id the API rejects (#4940)
- **Claude**: keep adaptive thinking for Haiku 5.5 and downgrade to `enabled/10000` only below major version 5 (#5183)
- **Thinking**: keep `reasoning_effort: max` for GPT-5.6 / GPT-6 served through OpenAI Compatible nodes instead of clamping it to `xhigh` (#5186)
- **Codex Image**: drive the `image_generation` tool call from `gpt-6-sol` instead of the legacy `gpt-5.6-terra` host, and add `cx/gpt-6-sol-image`; drop the `gpt-5.6-{sol,terra,luna}-image` aliases they supersede
- **Capabilities**: match `*gpt-6*image*` before the generic `gpt-6` family pattern so `gpt-6-sol-image` resolves as an image model instead of inheriting the chat caps (vision/reasoning/1.05M window) and losing `imageOutput`

# v0.5.109 (2026-10-23)

## Features
- **Combos**: add Smart Router (System One) evaluation with adaptive session stickiness (Smart Switch, Strict Lock, Per-Turn) to retain prompt cache; introduce SmartPolicyModal and System One router picker in dashboard (#4975)
- **Combos**: add search box for combo list with case-insensitive filtering by name and model IDs, filtered count, clear action, and selective bulk actions (#9b4ea9e)
- **Image & MITM**: support reference image inputs (base64 and data URIs) for Gemini and Antigravity image generation; ensure MITM directory is auto-created on startup (#4981)
- **Web Providers**: add web provider executors (`deepseek-web`, `gemini-web`, `muse-web`, `chatgpt-web`, `uc-web`, `veoaifree-web`), shared browser pool (`browserPool`), TLS impersonation via `wreq-js` for `grok-web`, lazy runtime installer for Playwright/wreq-js, and browser session cookie capture (#38a0c44)
- **Providers**: add SenseNova provider support (`sensenova-6.8-flash-lite`, U1.5 image models) with image configuration options and connection validation (#5079)
- **Ollama**: support System One decision models (`clef`, `clef-flash`) with host path normalization (#4731)
- **RTK**: support user-authored custom system prompt injected across OpenAI, Responses, Claude, Gemini, and Kiro request shapes (#8a84204)
- **STT**: add Codex OAuth transcription provider (`cx/transcribe`), reusing existing Codex OAuth chat connections with 24 kHz PCM16 WAV conversion and bounded private temp files (#5074)

## Fixes
- **CodeBuddy**: send the plugin's request/conversation id headers (`X-Request-ID`, `X-Conversation-ID`, `X-Conversation-Request-ID`, `X-Conversation-Message-ID`) on CN and intl chat requests — without them the gateway's channel check rejects every call with `400 / 11128 "request illegal"`
- **CodeBuddy**: align the `#5024` backoff tests with the current request-scoped contract — `checkFallbackError` reports `requestScoped: true` for unclassified 4xx, and a combo now advances past a malformed CodeBuddy body instead of stopping on the first member
- **Combos**: advance past request-scoped 4xx rejections (validation, unsupported parameter, context overflow) instead of terminating combo (#5057)
- **Combos**: fall through to next member when streaming response returns HTTP 200 but produces zero content frames (#ca7b540)
- **Combos**: try next model when provider returns HTTP 400 for insufficient credits or balance too low (#4713)
- **Antigravity**: dynamically resolve unadorned models to tiered variants from client `reasoning_effort` (#82aeb90)
- **Antigravity**: update User-Agent to `hub/2.24.0` resolving HTTP 404 on Gemini 4 Argon; add `gemini-4-argon-medium` and `gemini-4-argon-low` tiers, including them in quota tracking (#4816)
- **OpenCode**: send `reasoning_effort` instead of `thinking` object for `glm-5.3-flash-free` to prevent upstream 400 rejection (#32c5f30)
- **OpenCode Free**: honor `low|high|max` reasoning efforts for `oc/deepseek-v4.1-flash-free` instead of collapsing `low` to `high` (#313559f)
- **OpenCode Free**: full reasoning support for `oc/mimo-v2.6-flash-free` across plain OpenAI `reasoning_effort` enum and SSE aggregation / translators (#b833128)
- **Transports**: allow transports to declare thinking format; nest `reasoning:{effort,summary}` for OpenCode Go and Muse on `/responses` routes (#3014)
- **Streaming**: synthesize missing `id` on streamed tool-call fragments so strict OpenAI clients do not abort (#4992)
- **Streaming**: restore original caller tool names on OpenAI passthrough path when renamed by OpenCode fingerprinting (#4986, #4994)
- **DB**: strip NUL bytes from bound strings across all SQLite drivers to prevent write errors or truncation on raw binary values (#5055, #4917)
- **Usage**: support `/api/balance` for Ollama Cloud quota tracking (session 5h, weekly 7d resets, allowance/credits) (#5026)
- **CommandCode**: resolve short plan IDs (`go`, `individual-go-v1`) with 10-credit cap, colored percentages, and dedicated `/alpha/whoami` connection probe (#4a76b8d)
- **CodeBuddy**: back off and advance combo on international connection errors (HTTP 400 "request illegal" / "conversation id missing") (#5024)
- **Codex**: skip ChatGPT Free accounts for image generation and use Go-compatible `gpt-5.6-terra` main model (#b08f12d)
- **Qoder**: treat 10605 queue capacity signals as transient rather than billing blocks; add static model config for Sonus/Cantus; restore `PROVIDER_CAPABILITIES` table (#2720cd2)
- **Capabilities**: advertise 500k context window for Grok 4.7 matching upstream limit (#b065531)
- **GitHub**: refresh Copilot fallback model catalog with current models and set default fallback to `gpt-5-mini` (#dbdbb64)
- **OpenAI**: strip and rename `max_tokens` to `max_completion_tokens` to prevent 400 rejections on modern models (#7c42d8f)
- **Kiro**: normalize Anthropic model IDs and snapshot dates to Kiro-accepted upstream aliases; fix MiniMax casing to `minimax-m2.5` (#3ce2b82)
- **Headroom**: compress native Gemini, Antigravity, and Responses tool output text (#4070)
- **Headroom**: support native CommandCode requests stored under `params.messages` (#4552)
- **Security**: bump `undici` to 7.30.1 and bind Headroom port to `127.0.0.1` in docker-compose.yml (#08ef047)
- **Docker**: pin `node:22.23.4-alpine` and `.nvmrc` to address October 2026 security CVEs (CVE-2026-111497) (#32a064e)
- **Dependencies**: upgrade Monaco editor to 0.57.0 (DOMPurify 3.4.15) and pin CDN loader copy (#5883110)
- **Dashboard**: clarify API Key Created modal guidance that keys can be viewed or copied later from the list (#a3ca2f9)
- **Media Providers**: keep connection card for OAuth providers with API-key media lanes (#00dd3df)
- **Search**: reset regex state between model matches in search filters (#5853a88)
- **Pi Settings**: declare `existingProvider` before use in POST handler to prevent ReferenceError 500 (#342ecb0)
- **Tests**: triage master test suite (GLM-5.2 effort, gpt-6.1-sol codex capabilities, image SSRF mocks, refresh known-fails) (#b6a9ca4)

# v0.5.104 (2026-10-15)

## Features
- **Gemini**: add Gemini 4 Argon (`gemini`/`vertex`, plus a `high` tier on Antigravity) — non-dismissible gemini-level thinking, 1M context, Vertex defaults to `global` location
- **Usage**: Cursor IDE quota via DashboardService (spend + request buckets) (#4689)
- **Cursor**: resolve Auto (Server Picks) to the account's default agent model (#4692)
- **Quota**: anchored auto-ping schedule at fixed local times with timezone/DST support and schedule modal (#4848); unify mode selection into a 3-way toggle, default timezone to local, bring schedule config to the quota page
- **Providers**: add Nous Research OAuth + free-tier provider
- **UI**: model picker regex/negation search, Select/Deselect All, provider filtering, and per-provider wildcards

## Fixes
- **Streaming**: fill a missing `id` on streamed tool-call fragments so strict OpenAI-compatible clients stop aborting the turn with "Expected 'id' to be a string" (#4992)
- **OpenCode**: restore the caller's tool name on the openai→openai passthrough path, so a fingerprint-renamed tool (`read` → `read_client`) no longer reaches the client as a tool it never declared (#4986, #4994)
- **Nous**: add missing attribution tags to API-key requests through compatible Chat Completions connections, preserving caller tags and identities (#4745)
- **Cursor**: recover long sessions from empty AgentService turns (#4690); hold strictProxy on the AgentService h2 path (#4696)
- **OpenCode**: encode inverted timestamp in translated session IDs so non-OpenCode clients pass Zen free-tier checks (#4780); inject `reasoning_content` placeholder for Zen multi-turn chats (#4805); move free tier to `/inference/v1` with the v2 client fingerprint (#4842)
- **OpenCode Zen**: use attested free-tier identity for `-free` models on keyed lane (#4784)
- **OpenCode Go**: route `claude-haiku-5-5` to `/messages` with adaptive thinking (#4727); drop `response_format` for the deepseek family (relay rejects with a bare 400)
- **Capabilities**: add missing OpenCode Free reasoning entries (space-bunny & co) so `reasoning_effort` stops being silently stripped; advertise PDF input for current Claude models (#4761)
- **Combos**: fallback when a model returns HTTP 200 with zero usable content (#4750)
- **Qoder**: surface add-on (free-credit promo) quota in the quota tracker (#4758)
- **Translator**: return Claude messages for forced SSE JSON responses (#4789)
- **Vertex**: honor API-key project/location for Gemini 4 Argon (#4821)
- **GitHub**: route Copilot embeddings to `api.githubcopilot.com` (#4793)
- **Codex**: drop retired gpt-5.5 from registry, image, and auto-ping; CLI preset default to `gpt-6.1-sol`
- **Gemini**: drop sampling params and order functionResponse-last for Gemini 4 (#4802)
- **Models**: expose no-auth free providers in `/v1/models`; prune custom models on node deletion
- **Models**: `/v1/models` answers in ~0.3s instead of 10-20s — live provider catalogs (Kiro, Qoder, Kimchi, Copilot, Cline, Cursor, Zed, compatible providers) are now resolved by a background pass every 10 min and cached, so no request waits on a provider; covers the providers that have no static model list and shows the full catalog instead of the last reachable one
- **Usage**: token fallback for `input_tokens` rows in 24h/today stats; stable key masking
- **Dashboard**: unclip proxy dropdown and tooltips via body portal

# v0.5.99 (2026-10-08)

## Features
- **Antigravity**: refresh model catalog with Gemini 3.8 Flash (High/Medium/Low), Gemini 3.6 Flash, and Gemini 3.1 Pro High; remove deprecated 3.5/3-flash models; update MITM default to `gemini-3.8-flash-medium`
- **Antigravity**: add Claude Sonnet 5.5 and Opus 5.5 support with reasoning effort variants, pricing, and family quota routing
- **Bedrock**: add Amazon Bedrock (`bedrock` and `bedrock-xai`) provider with static keys, AWS SSO profiles, native SigV4 signer, and shared EventStream decoder (#4157)
- **Hermes**: per-profile configuration across API, Dashboard card, and CLI menu with bulk apply, scoped reset, and auxiliary roles (#4660)
- **Hermes**: audio transcription via 9router — an "Audio STT" toggle in the card points the profile's `stt.openai.base_url` at `/v1/audio/transcriptions` with an STT-kind model picker (#4763)
- **API Keys**: per-API-key access control — restrict keys to allowed combos and models via interactive modal
- **ElevenLabs**: add Scribe speech-to-text support (#4537)
- **Proxy Pools**: add Netlify serverless relay proxy pool with digest-deploy API and dashboard management modal
- **Providers**: add MiniMax Code (`mcode`) credits provider
- **System One**: support Cloudflare AI `clef-flash` endpoint
- **Codebuddy CN**: sync catalog with 2026-09-30 server config
- **Dashboard**: open 9Remote sidebar item directly to website

## Fixes
- Avoid Headroom compression warnings caused by large unchanged tool schemas (#4809).
- **Dashboard**: fix mobile layouts for API Keys card (alignment, code wrap), header breadcrumbs (overflow collision), model chips (full width, break-all), and Claude CLI settings
- **Gemini**: do not treat properties map as schema node when tool parameter is named `properties` (#4620); rename `$ref` keys in `functionResponse` payloads
- **Translator**: uniquify duplicate `tool_call_ids` for Gemini (#4532)
- **Capabilities**: mark GLM-5.3 as unable to disable thinking (#4656); correct GLM-5.2/5.3 context window to 1M (#4544)
- **Combos**: show compatible node models in picker without an active connection (#4659)
- **CLI**: take `connect` models from server; add `show`, `--save`, Pi and Oh My Pi; store full model IDs in TUI combos
- **Kimi**: route Responses clients to Kimi Code `/responses` endpoint
- **Cursor**: forward reasoning effort to AgentService Run; reject empty turns without successful stop
- **Codex**: preserve explicit tool strict flags; track exact image token usage
- **Ollama**: report `prompt_eval_cached_count` as cached tokens in usage tracking
- **Muse**: route Responses-only models to declared transport and nest reasoning effort
- **TTS**: accept server model and voice in self-hosted example

# v0.5.95 (2026-10-01)

## Features
- **Hermes**: sync the auxiliary role picker with Hermes 0.21.5 (`hermes_cli/config_defaults.py`) — add TTS Audio Tags, Triage Specifier, Kanban Decomposer, Profile Describer, Review and Goal Judge; drop Web Extract, which stopped calling an LLM
- **CLI**: Hermes profile selection in the settings menu — per-profile status header, Quick Setup and Reset scoped to the picked profile, plus "Apply to All Profiles"
- **Dashboard**: per-profile Hermes config — profile selector with status dots and run command, Apply/Reset scoped to the selected profile, per-profile Manual Config paths, and an "Apply to All Profiles" action
- **Hermes**: profile-aware settings API — target a profile with `?profile=`/body, list them via `GET /api/cli-tools/hermes-profiles`, and apply endpoint + API key to every profile in one call (`applyToAll`)
- **Providers**: add Meta Muse provider with OAuth login and model catalog; add v1m System One provider
- **GLM**: add Z.ai OAuth login to GLM Coding (dual-auth)
- **Codex**: add GPT-6.1 Sol; expose 1M context variants for GPT-6 and GPT-5.6; add gpt-daybreak/reserve models and route bare `gpt-5.x`/`gpt-6.x` slugs to codex
- **Claude**: add Claude Sonnet 5.5 (plus `claude-opus-5.5` models in the Kiro registry)
- **CLI**: add `connect` command for remote 9Router servers
- **Providers**: per-provider custom header overrides from the registry
- **Agnes**: seed the 2.5/3.0 model ids in the registry
- **Usage**: sync `?provider=` URL param with provider filter for bookmarkable deep links (#4395)
- **Dashboard**: drop NEW badges in sidebar, mark 9Remote as HOT

## Fixes
- **Hermes**: stop breaking the config write when an earlier save left the `model: ""` sentinel behind (duplicate-key handling in `config.yaml`)
- **Claude**: preserve intentional prefill from non-messages[] source formats; keep a trailing user turn so cleanup never yields assistant prefill
- **Claude**: cache a tool loop's final tool results with the 4th breakpoint
- **Claude**: resolve Sonnet 5.x to adaptive thinking so no forged thinking placeholders are sent; inject unsigned thinking placeholders for opencode-go DeepSeek `/messages` (#4436)
- **Thinking**: add `xhigh` to claude-adaptive thinking levels
- **Claude**: keep a user turn whose only block is `container_upload`
- **Capabilities**: publish real GPT-6/GPT-5.4+ context windows and combo token limits
- **Responses**: wait for real usage before emitting `response.completed`, bounded by a 3s watchdog
- **Codex**: stop refresh-token reuse that logs accounts out on auto-ping; preserve hosted web search on GPT-6 Sol/Luna; remove ghost models
- **Grok CLI**: send Grok CLI 1.0.44 so proxy stops returning HTTP 426
- **Proxy**: auto-fallback to insecure TLS on self-signed cert errors; hold strictProxy when no proxy resolves
- **Translator**: strip `errorMessage` and other non-standard schema keywords from Gemini tool schemas; dedupe same-name tools for DeepSeek models (#3333)
- **Codebuddy**: parse the 6004 rate limit error and extract `resetsAtMs`; forward `recurring` for codebuddy-intl quota packs (#4422)
- **CLI Tools**: replace `sk_9router` placeholder with first active dashboard API key
- **Dashboard**: exclude hidden providers from usage stats provider list
- **Capabilities**: add deepseek-v4-1-flash vision alias; add zed to live catalog providers

# v0.5.91 (2026-09-26)

## Features
- **Web Search & Fetch**: add TinyFish Search and Fetch with one API-key connection, normalized results, and official provider icon
- **Providers**: add Token Harbor provider and four OpenAI-compatible aggregator providers (dahl, atria, agnes, bai)
- **Claude**: forward `x-claude-code-session-id` on OAuth requests; merge client `anthropic-beta` flags and forward rate-limit headers; return thinking text to OpenAI-format clients
- **Codex**: add GPT-6 Sol and Luna support
- **CLI Tools**: support multiple model profiles for Codex CLI
- **Hermes**: multi-role model config (delegation + auxiliary slots)
- **OpenCode Go**: complete the Go catalog (40 models) with auto-fetch + family endpoint regex
- **Usage**: show and redeem free limit resets for cc accounts
- **Cline**: expose the `cline-free/*` tier and price it at zero
- **Combos**: display vision adapter models in an ordered table view

## Fixes
- **Claude**: decloak tool names when `toolNameMap` misses (#4342); update spoofed cli version to 2.1.280 to support Opus 5.5
- **Providers API**: make POST `/api/providers` O(1) and refuse silent key overwrite (#4350)
- **Capabilities**: stop caching the catalog source per module copy (#4351)
- **OAuth**: stop Zed paste-token crash and add IDE auto-import (#4359)
- **Dashboard**: resolve combo limits with the server's capabilities (#4360); lazy-load charts and `marked`, preload in background on idle
- **Responses**: carry the streamed output items in `response.completed` (#4307)
- **STT**: dispatch live-API-only Gemini models over the Live WebSocket transport (#4006)
- **Gemini**: guard terminal model turns and unresponded functionCalls in `normalizeGeminiContents`
- **Command Code**: replay raw byte chunks to preserve all NDJSON lines
- **Translator**: stop emitting empty `<think>` markers into OpenAI content
- **CLI Tools**: refresh Codex settings after apply (#4347); keep existing `ANTHROPIC_AUTH_TOKEN` when applying Claude settings
- **Tray**: native arm64 macOS menubar binary, no Rosetta required
- **CLI**: filter model selector by active connections and noAuth providers
- **Usage**: key live byApiKey stats by full api key to prevent team-key collision and preserve API key usage attribution
- **Tailscale**: cap enable-flow health wait at 20s

# v0.5.86 (2026-09-23)

## Features
- **Xiaomi MiMo**: server-assisted desktop login for headless/Docker deployments, five account clusters (cn/sgp/ams/ru/in), and v2.6 pro/flash/pro-ultraspeed models with dual-route (account service vs. cloud API)
- **Claude**: add Claude Opus 5.5 support
- **i18n**: translate React text rewrites via characterData mutation observer

## Fixes
- **Proxy Pools**: keep request headers intact through Vercel/Cloudflare/Deno relays (spreading a `Headers` instance yielded `{}`, dropping auth and content-type)
- **Xiaomi MiMo login**: keep the session in the httpOnly cookie only, require dashboard auth on the proxy branch, and stop forwarding authorization headers upstream

# v0.5.85 (2026-09-22)

## Features
- **System One**: add `/v1/systemone` decision endpoint for Jev models (OpenCode Zen and OpenRouter lanes), wire into sidebar and Media Providers page with interactive probe testing
- **CLI Tools**: add dynamic configuration, settings APIs, and official logos for Pi, OMP, Crush, ForgeCode, Smelt, and CodeWhale
- **Analytics & Usage**: add Requests mode, provider/model breakdown charts, All Time period filter, and refined overview cards
- **Combos**: add Cursor/Claude Default presets; support bulk select/delete and bulk strategy changes (Fallback / Round Robin / Fusion)
- **Model Capabilities**: expose model capability metadata on `/v1/models` and aggregate capabilities across combo targets
- **OpenCode Zen & MiMo**: add OpenCode Zen (`opencode-zen`) provider with free-tier fingerprint; switch default vision fallback to MiMo V2.6 Flash Free
- **Qoder CN**: add `qoder-cn` provider for qoder.com.cn with OAuth flow, COSY protocol, and CN gateway routing

## Fixes
- **Translator**: map Claude `refusal` stop_reason to `content_filter` and surface explanation; strip replayed reasoning fields for Groq, Mistral, and Cerebras (#4220)
- **Antigravity**: drop requestType `agent` to avoid false 429 `RESOURCE_EXHAUSTED`; separate weekly and short-window (5-hour) quotas and deduplicate dashboard rows
- **Responses API**: report usage on `response.completed` so clients can auto-compact (#3432)
- **Hugging Face**: migrate to Inference Providers router (`router.huggingface.co`), expand image models catalog, and add STT route
- **Qoder**: prevent signed request replay (`403/103 Duplicate request`), handle code 110 billing blocks, and preserve upstream SSE error status
- **Performance**: bound usage `lastUsed` scan to a 2-day window; map large budget tokens to `max` reasoning tier
- **Docker**: publish verified multi-platform images (linux/amd64 and linux/arm64) with configurable apk build mirrors

# v0.5.81 (2026-09-18)

## Features
- **Xiaomi MiMo**: merge MiMo Desktop support into `xiaomi-mimo` with dual auth (API key + Desktop/OAuth session), Preview models support, and encrypted-callback OAuth flow
- **Claude Code**: add 1M-context toggle (`[1m]` marker) and drive `CLAUDE_CODE_AUTO_COMPACT_WINDOW` directly from the dashboard
- **Models**: add DeepSeek-V4.1-Flash to DeepSeek provider, CodeBuddy-Intl, and Ollama (`deepseek-v4.1-flash:cloud`); enable `low`..`max` reasoning effort levels and vision capability for DeepSeek-V4.*
- **i18n**: integrate Persian (fa) translation

## Fixes
- **Cursor**: stop AgentService empty turns (`OUT 0`) and silent hangs — fold system prompts instead of `custom_system_prompt`, send `ModelDetails`, read Composer/Grok `thinking_delta`, ack request-context without echoing MCP tools, and reject IDE execs so the model can continue
- **RTK**: for Cursor, compress source-format `tool_result` / `role:tool` **before** translation — its translator rewrites those shapes, so post-translate compression missed them. Other providers keep the post-translate pass unchanged
- **OpenCode / OpenCode Go**: resolve 403 `FreeTierError` and 429 rate limits with canonical session format, valid User-Agent, and stable upstream session reuse; force stream and declare `forceStream` for free-tier SSE aggregation; cloak decoy tools, normalize Muse Free tool choice, and strip prior reasoning items on Responses models; route Union Alpha via Messages API
- **Kiro**: preserve underscores in tool names (`mcp__server__tool`) and restore client tool names in responses; use neutral placeholder for tool-result-only turns; forward tool-result images
- **Stream**: report aborts after HTTP 200 in-band (per-format error frames) instead of closing silently
- **Command Code**: preserve images and `reasoning_effort` on `/alpha/generate`; retry transient stream errors and avoid fake stop chunks; add Quota Tracker support
- **Zed**: harden OAuth lifecycle (preserve `systemId`, renew proxy timeout), support live model resolution, and lower display priority in OAuth list
- **Antigravity**: scope cached thought signatures to model family; strip Claude Code billing headers from system prompts; sanitize Hermes system identity
- **Codex**: route bare `codex-auto-review` requests to the Codex provider (#4135)
- **Auth**: do not cool down an account for request-scoped 4xx errors
- **Usage**: improve DeepSeek credit balance display as currency credit instead of 0/total quota bar
- **Model Catalog**: scope synced catalog to gateways and declare vision capabilities for DeepSeek V4.1-Flash IDs

# v0.5.75 (2026-09-10)

## Features
- **Video**: add OpenRouter and Vertex AI (Veo) video generation on `/v1/videos/*` via a provider adapter layer; poll requests resolve their provider from `x-connection-id` or `?provider=`
- **Antigravity**: add weekly quota tracking (Gemini weekly / Claude & GPT weekly) and free-tier handling from `retrieveUserQuotaSummary` (#3892)
- **Codex**: add GPT Image 2.5, Flare and Sunburst image models with multi-image support; add the same ids to the OpenAI catalog
- **Qoder**: surface usage to all clients and stop inlining large attachments — images upload through `/api/v2/image/upload` like qodercli, oversized file blocks become stubs, context tier auto-escalates
- **OpenCode Go**: add newly published models (glm-5.3, kimi-k3, deepseek-flash, longcat-2.0, hy4-preview, hy3 on chat/completions; qwen3.8-max, qwen3.8-flash on `/messages`; grok-4.6, gpt-5.6-luna on Responses) and list `deepseek-v4.1-flash` first in the catalog
- **CLI tools**: group the model selector by provider with full-text search and manual custom model ID entry
- **CodeBuddy-CN**: replace `deepseek-v4-flash` with `deepseek-v4.1-flash`

## Fixes
- **Tools**: scope Claude tool type defaulting to gateways declaring `requireClaudeToolType` — the global default broke Anthropic-compatible endpoints that only accept the legacy typeless tool shape (#3905)
- **Claude**: cap re-anchored `cache_control` at the 4-marker budget so a spent budget no longer 400s and triggers a full combo failover; wrap bare single-object content turns before the mid-conversation-system fold
- **Cline / Airforce**: unwrap the `{"success":true,"data":…}` envelope on non-stream chat completions (#3644); add the live Cline/ClinePass model catalog and refresh Airforce free models
- **Cline**: stop `workos:`-prefixing ClinePass API keys (401 on every request, #2333) and add clinepass token refresh
- **Kiro**: never send a top-level `systemPrompt` (`400 REQUEST_BODY_INVALID`); route requests through current runtime surfaces (#3776)
- **Codex**: strip Unicode-property tool schema patterns the validator rejects (#3922); restore the `Version` header and single-source the CLI version
- **DeepSeek**: keep Anthropic-only tool types when forwarding to `/anthropic/v1/messages`
- **Qoder**: drop the Responses usage plumbing from shared translator/handler code, which changed token accounting for every provider, not just Qoder
- **Antigravity**: normalize contents and handle intermediate tool responses; protect the OAuth token-refresh path from Google anti-abuse rate limits (#3813)
- **Providers**: clear stale connection health state (`modelLock_*`, `backoffLevel`, `rateLimitedUntil`, `errorCode`) when a connection is re-validated (#3810, #3830); remove the duplicate `qwen` provider that shadowed `alims-intl`
- **Video / Vertex**: reject job ids and model ids that would escape the request URL path (SSRF)
- **Usage**: parse the Fable weekly limit from `limits[]` instead of fabricating a row (#3847)
- **Auth**: set a 24h `maxAge` on the dashboard session cookie

# v0.5.69 (2026-09-05)

## Features
- **Codex**: add GPT 6.0 Astra (`gpt-6-astra`) with vision, thinking and search capabilities
- **Usage**: add Claude Fable quota tracker support with weekly window normalization (`weekly fable (7d)`)
- **Dashboard**: group Antigravity Gemini and Claude quotas in Quota Tracker, prune stale hidden keys
- **OpenCode Go**: add `muse-spark-1.3-contributor` model and support parallel tool calls on Responses path (#3819)
- **Providers & Models**: align CodeBuddy-CN catalog/capabilities with server config; add GPT-5.6 Sol, Terra, Luna image aliases on Codex (#3806); refresh Qoder catalog with capability mapping and image pass-through
- **CLI tools**: replace Copilot MITM with VS Code extension setup guide
- **Gemini**: persist and replay `thoughtSignature` scoped by session namespace

## Fixes
- **Claude**: normalize adaptive auto effort (`output_config.effort`) (#3792)
- **Antigravity**: prevent Google anti-abuse rate limits during multi-account refresh (#3813)
- **Anthropic-compatible**: forward Claude beta flags to nodes fronting Anthropic (#3797)
- **Dashboard**: dynamic mode label for local/remote detection (#3801)
- **Codex**: format reset credit API errors cleanly (#3778)
- **Security**: guard cowork MCP tools probe against SSRF (#3783)
- **OpenCode Go**: track OpenCode Go quota (#3791) and send stable session headers (#3800)
- **Logger**: suppress noisy background token refresh logs
- **CLI**: export packed `.tgz` directly into workspace root instead of parent directory

# v0.5.65 (2026-09-03)

## Features
- **Fetch**: add Ollama Cloud web fetch provider
- **Gemini / Antigravity**: add Gemini 3.8 Flash support and bump IDE fingerprint to 2.11.0
- **Claude**: add Claude Fable 5.1 support (adaptive thinking with `output_config.effort`), bump Claude Code fingerprint to 2.1.258 for new-model access
- **Providers**: add client-side status filter (All / Active / Inactive / No connection) on the Providers dashboard; add max height and scroll for connection list
- **Providers & Models**: streamline tokenrouter model catalog down to 22 flagship/newest models and add missing provider icons; refresh Codebuddy-CN catalog (add hy4-preview/hy3/glm-5.3/kimi-k3-1, drop EOL glm-5.0/glm-4.7)
- **Models**: capability toggles (vision, reasoning) when adding custom models with upsert and live caps refresh
- **CLI tools**: support saving and managing custom API key presets
- **Quota**: add usage and rate-limit tracking for Groq via `x-ratelimit-*` headers
- **i18n**: complete Indonesian translation (1391 keys)

## Fixes
- **Security**: close SSRF guard bypasses in `ssrfGuard.js` (alternate IPv6 encodings, hostname trailing dots, wildcard DNS resolution check, safe redirect handling) (#3714)
- **Model markers**: strip the `[1m]` context marker Claude Code appends to model names (`claude-opus-5[1m]`) preventing model resolution failures (#3690)
- **Claude**: drop `server_tool_use` blocks carrying foreign IDs to avoid Anthropic 400 rejections; never anchor cache breakpoints on `defer_loading` tools (#3567)
- **Antigravity**: strike-break optimistic quota readings that keep 429ing by blocking the connection+model pair for 15m after 3 strikes (#3681); preserve client identity on model catalog requests (#3414)
- **Auth**: protect root `/responses` rewrite requiring API key validation in dashboardGuard
- **Chat & Docker**: return 503 Service Unavailable when all credentials are rate-limited; explicitly bundle `node-machine-id` into standalone Docker runtime image
- **OpenCode**: route Muse Spark models to `/zen/v1/responses` and declare vision support; filter inactive free model
- **Kiro**: preserve inline images as OpenAI-compatible `image_url` parts in OpenAI MITM; remove redundant top-level `systemPrompt` from payload
- **Usage**: read Responses-shape `cached_tokens` in `extractUsageFromResponse` for non-streaming traffic
- **Models**: support single model lookup with provider-prefixed IDs (e.g. `cc/claude-sonnet-5`)
- **Translator**: route Gemini thinking through `reasoning_effort` on OpenAI-compatible wire; convert `prefixItems` and ensure array items in Gemini schema sanitizer
- **UI**: apply persisted theme before first paint to prevent flash on reload; translate combo vision adapter label

# v0.5.59 (2026-08-29)

## Features
- **Search**: new web search providers — Antigravity (Google Search grounding
  on the existing OAuth account pool, citations keyed and merged by URL) and
  Xquik (X search with `x-api-key` auth, cursor pagination, credit-based
  usage), both on `POST /v1/search`. Based on #3437 by @Nautilaceae
- **Search**: ollama-search and zai-search borrow a chat provider's API key
  instead of requiring their own connection, driven by a new
  `credentialFallback` registry field. zai-search later folded into the `glm`
  provider itself so the web search page shows the shared connection
- **Models**: daily background sync of model capabilities from models.dev —
  modalities keyed by model id (majority of sources must declare one),
  context/output limits keyed by provider + model, strictly additive and
  sitting below the hand-written tables. ETag + mtime cache, 60s startup
  delay, `MODEL_CATALOG_SYNC=off` to disable
- **Models**: add GLM-5.3-Flash (1M context, natively multimodal), DeepSeek
  V4 Vision, Grok 4.5/4.6 (500k context); correct glm-4.6v/4.5v video input
  and output limits, backfill glm-4.6v on glm-cn
- **Usage**: show the Zed plan quota on the dashboard — plan, edit
  predictions, hosted model requests and billing-cycle reset; unlimited rows
  render as "N used · Unlimited"
- **Usage**: track GPT-5.3-Codex-Spark quota windows (spark_session /
  spark_weekly) from the Codex usage response (#3431)
- **Antigravity**: quota-aware routing — on 409/429 fetch live quota for the
  exact per-model resetAt and skip only the exhausted account/model pair;
  report the earliest reset when every account is blocked (#3561)
- **Antigravity**: map image `size` to the aspect-ratio model suffix (-WxH);
  add the Gemini 3.7 Flash tiers to MITM defaultModels so they show up in
  the dashboard model-mapping table
- **Dashboard**: bulk import Grok CLI accounts from JSON — paste an array or
  drag-drop multiple .json files, all OAuth connections created in a single
  call, mirroring the codex flow
- **CLI tools**: endpoint presets shared across every tool card through one
  live-resyncing store, instead of per-card localStorage copies that never
  saw each other's saved endpoints
- **Token Saver**: configurable compression timeout (`headroomTimeoutMs`) —
  the fixed 3000 ms made busy machines time out and send inconsistently
  compressed bodies, hurting prompt caching
- **i18n**: pt-BR expanded to 1132 terms

## Fixes
- **Claude Code**: add Claude Fable 5.1 and advertise Claude Code 2.1.258 in
  both the request header and billing identity; use its permanent adaptive-thinking
  mode with `output_config.effort`
- **Stream**: record usage when a client closes on the terminal event — the
  Responses API has no [DONE] sentinel, so codex closed the socket on
  `response.completed` and cancelled the reader before flush() ran its usage
  side effects; the tail now lives in a once-guarded finalizeStream(). Also
  stop logging a disconnect for every completed Responses call
- **Stream**: parse the trailing NDJSON line an Ollama stream leaves behind
  without a closing newline — the final chunk carrying `done_reason` and the
  token counts was dropped
- **Session**: read the Claude Code session id from the
  `x-claude-code-session-id` header — `metadata.user_id` is dropped by
  Responses translation, splitting one conversation across several
  `prompt_cache_key` values and missing the upstream prefix cache
- **Usage**: preserve nested `cached_tokens` — the top-level-only read
  persisted `cached_tokens: 0` for every Responses-format provider (codex,
  grok-cli, …), billing cache hits at the full input rate
- **Usage**: GLM quotas accept CREDIT_LIMIT plans and multi-interval windows
  (5h session / 7d weekly) instead of overwriting a single "session" key
- **Models**: the catalog sync no longer erases its own output — deltas were
  measured against the previous run's writes (the second run cut `providers`
  from 20 entries to 5); one vote per provider in the modality tally, ETag
  restored from file on startup, and the worker thread dropped after the
  bundler rewrote its path into a module-not-found error
- **Executor**: CommandCode returns errors as a `type:"error"` event inside
  an HTTP 200 NDJSON stream — peek the first events before committing, abort
  and return a real 4xx/5xx so combo/account fallback triggers instead of
  streaming the error text as content
- **Search**: scope failure locks on the credential-fallback path — a failing
  search locked `modelLock___all` and took the shared glm key offline for
  chat as well; locks are now attributed to the connection's owner and
  scoped to `websearch:<provider>`
- **Providers**: connection tests get a 15s AbortSignal timeout instead of
  hanging and exhausting the browser socket pool; guard undefined provider
  names on the providers page
- **Antigravity**: sanitize competing-client branding via a config-driven
  rule table (Zed's Claude-agent prompt, opencode → antigravity) — upstream
  answers 429 Quota Exhausted. Applied in the executor so the shared
  openai-to-gemini translator leaves gemini/vertex/zed untouched
- **MiniMax**: preserve images on the sourceFormat-matched OpenAI transport
  — MiniMax-M3 resolved a Claude-shaped body posted to the OpenAI endpoint,
  silently dropping `image_url` blocks (#3418)
- **Claude**: decloak tool names in same-format streaming passthrough —
  OAuth-cloaked names (CLAUDE_TOOL_SUFFIX) leaked to the client and every
  tool call was rejected as unknown
- **Tools**: default a missing `tools[].type` to "custom" on Claude-format
  requests — strict Anthropic-compatible gateways (MiniMax) reject the
  request with 400 otherwise
- **Translator**: zai thinkingFormat sends the top-level `reasoning_effort`
  object GLM-5.2+ requires — every GLM-5.x request ran at the model default
  (max); gated on GLM-5.2+ since older GLM does not read it (#2721)
- **RTK**: system prompt injection matches each target wire format
  (Chat/Responses/Claude/Gemini/Kiro) and is exact-idempotent across retries,
  so distinct prompts sharing a long prefix are no longer collapsed (#3202).
  Also set the diagnostic before the silent null return on Responses
  translation failure so the panel is no longer blank
- **OpenCode**: route muse-spark through /zen/v1/responses (it 500s on
  chat/completions), normalizing the Chat fields the Responses API rejects
  and clamping max/ultra effort to xhigh
- **CLI**: install better-sqlite3 without build tools on Node 22+ (N-API
  13.0.3 ships per-platform prebuilds, `--ignore-scripts` skips the implicit
  node-gyp build); Node < 22 stays on 12.6.2, working installs untouched
- **CLI tools**: send the API key Codex actually reads —
  `[model_providers.9router.http_headers]` instead of auth.json (which left
  every request 401 and clobbered an existing ChatGPT login); subagent model
  moved to `agents.default_subagent_model`
- **OAuth**: refresh Cline tokens with the extension JSON contract
- **Dashboard**: clamp the API key mask length — keys shorter than 8 chars
  threw RangeError and crashed the media-provider detail page
- **UI**: wait for the Material Symbols font itself before revealing icons —
  `document.fonts.ready` resolved before the 4MB woff2 even started loading,
  leaving icons blank until a second load

# v0.5.55 (2026-08-14)

## Features
- **Auth**: native SAML 2.0 SSO alongside OIDC — AuthnRequest generation, ACS
  assertion handling, SP metadata export, admin config test, replay-protected
  via a `saml_state` cookie matched against `InResponseTo`
- **Providers**: add Alibaba Token Plan (`token-plan.ap-southeast-1`) — the
  fourth Alibaba key type, Singapore-only and OpenAI-compatible transport only
- **Providers**: add `glm-5.3` to GLM Coding and GLM (China)
- **Providers**: Kimchi accepts API keys as well as OAuth (dual auth), with a
  working Test Connection for both modes
- **Antigravity**: add Gemini 3.7 Flash and its tiered high/medium/low variants
  (also in the Gemini registry) with pricing and quota tracking
- **TTS**: add Fish Audio — model id travels in an HTTP `model` header, voice
  is a `reference_id` (preset or cloned voice model)
- **OpenCode-Go**: route by request format via declared transports instead of
  forcing every client into `/messages` — Codex/OpenAI clients no longer pay a
  lossy Responses→OpenAI→Claude double translation. Per-model `supportedFormats`
  guard; the bespoke executor is gone (its shared `_lastModel` cache could cross
  auth headers between concurrent requests)
- **Usage**: dedup + cache Claude quota calls (120s TTL keyed by access token,
  in-flight promise dedup, last-good read on soft failure) to stop multiple
  tabs tripping 429; manual refresh (↻) sends `force=1` to bypass the cache

## Fixes
- **Docker**: ship `sql.js` in the image so the pure-JS DB fallback can start —
  file tracing carried the package's JS without `dist/sql-wasm.wasm`, so a
  container with no native driver aborted with ENOENT and never got a database
  (#3248)
- **Usage**: read Gemini `usageMetadata` out of the antigravity `{ response }`
  envelope — every non-streaming antigravity request logged `IN 0 | OUT 0`
  (#3260)
- **Claude**: re-anchor passthrough cache breakpoints — the client's own
  `cache_control` markers point at pre-normalization offsets, so the tail was
  re-cached every request. Last system block and last tool pinned at 1h TTL,
  last assistant turn at 5m, mid-conversation system messages folded into the
  neighbouring user turn instead of hoisted into `body.system`
- **Combos**: detect images from Hermes and attachment payloads (`images[]`,
  `experimental_attachments`, message-level `image_url`/`audio_url`, inline
  `data:` URIs) so the Vision Adapter auto-switch fires for Hermes/Ollama/
  Vercel AI SDK shapes
- **Kiro**: intercept chat via `x-amz-target` — Kiro IDE 1.0.228+ moved
  `GenerateAssistantResponse` to `POST /` + header, bypassing MITM. Also emit
  the now-mandatory initial-response frame and map the `auto` model slot
- **Kiro**: report real output tokens and stop discarding usable turns
- **Qoder**: detect billing blocks at stream start and return a synthetic 403
  so combo/account fallback triggers instead of leaking the error into chat
- **Antigravity**: strip competitive system prompts (Zed IDE's Claude-agent
  prompt) that Antigravity flags with a 429 Quota Exhausted
- **OpenCode**: send the official client fingerprint on free-tier requests so
  the Console stops classifying traffic as unidentified and rate-limiting it;
  session id resolves conversation-stable to preserve prompt caching
- **Responses**: don't close the message on an empty `tool_calls` array — some
  providers attach one to every chunk, and the truthy check ended the message
  on the first content token (#3234)
- **Translator**: preserve `prompt_cache_key` when converting chat to responses
- **Models**: expose snake_case token limits on `/v1/models`
- **Combos**: strip `stream_options` from the Fusion panel fan-out to avoid a
  DeepSeek 400 (#3024); raise the dashboard model-test probe budget to 1024 and
  soft-pass reasoning-only responses (#3010)
- **Headroom**: the toggle reflects the `headroomEnabled` setting even when the
  proxy is down — it previously showed OFF while the engine kept calling
  `/v1/compress`; proxy status stays visible via the status chip
- **Hermes**: add the `api_key` parameter to the model block in YAML config
- **Providers**: add llm7 to provider test support

## Docs
- **i18n**: add Spanish, French, and Brazilian Portuguese README translations

## Security
- **Real IP**: `x-9r-real-ip` and the Host fallback were trusted from
  client-controlled headers whenever `custom-server.js` was not in the request
  path (`npm run start`, `start:bun`), letting a remote caller pose as local to
  skip API key auth and reach `LOCAL_ONLY_PATHS` (`/api/mcp/*`,
  `/api/tunnel/enable`, `/api/auth/reset-password`). The server now stamps a
  per-process `x-9r-peer-token` on every request it sanitizes and only trusts
  `x-9r-real-ip` behind it — falling back to Host in development and failing
  closed in production (GHSA-pjm4-8fpg-f9p6). Also fixes IPv6 loopback
  detection (`::1`, `::ffff:127.0.0.1`) and routes `npm run start` /
  `start:bun` through `custom-server.js`
- **Search**: `resolveBaseUrl()` rejects client-supplied non-public baseUrls
  (SSRF guard on `/v1/search`)
- **Login**: fresh-install remote login with the default password returns 403
  without issuing a JWT
- **Usage**: `/api/usage/request-details` redacts request/response payloads

# v0.5.50 (2026-08-05)

## Features
- **Providers**: add TokenRouter (300+ models via OpenAI-compatible gateway) with
  exact per-model pricing for 110 models and `reasoning_effort` thinking config
- **Providers**: add Self-hosted STT / TTS / Embedding — point 9Router at your own
  OpenAI-compatible speech and embedding servers (whisper.cpp, faster-whisper,
  Kokoro-FastAPI, llama-server, vLLM, Infinity). Unlike the named cloud providers
  these read `baseUrl` per connection, so one provider can front several machines
- **Combos**: default-enable vision/audio capacity adapter (auto-routes to a
  vision/audio-capable model when the target lacks that capability, falling back
  to `oc/mimo-v2.5-free`), wired into chat handler routing
- **Endpoint**: auto-provision a "Default Key" for first-time users so `/v1`
  works without a manual dashboard step
- **Codex**: support GPT-5.6 Max/Ultra reasoning-level overrides (cx/ routes only)
- **Qoder**: support PAT (Personal Access Token) connections end-to-end, alongside
  OAuth device flow
- **CLI tools**: add OpenDesign (manalkaff/opendesign) support
- **Headroom**: report effective payload savings (tool schema/history bytes broken
  out, byte-savings % reflects actual outbound reduction)
- **Ollama**: Cloud quota tracker (session + weekly) + proactive background OAuth
  token refresh scheduler for all providers

## Fixes
- **Providers**: remove Qwen (OAuth flow stopped working reliably)
- **Passthrough**: detect codex-tui/Codex Desktop as native Codex client — they
  were falling through to the translator and losing fields like `reasoning.summary`
- **OAuth**: scope antigravity header fixes to loadCodeAssist/onboardUser only
- **OAuth**: keep `open` external in the build so xAI/Grok token refresh works on
  Windows
- **OAuth**: declare missing `searchParams` in register-session handler (was a
  500 instead of JSON on error)
- **DB**: `ENABLE_REQUEST_LOGS` env var now overrides the UI setting correctly;
  observability defaults to off (opt-in)
- **Translator**: preserve Codex Responses Lite tool use across chat-native
  OpenAI-compatible providers
- **Translator**: don't drop image-only user messages in `prepareClaudeRequest`
- **Translator**: drop JSON Schema keywords Gemini rejects (`uniqueItems`,
  `contains`, `multipleOf`, `unevaluatedProperties`, `unevaluatedItems`,
  `contentSchema`)
- **Claude**: remove global header cache that leaked one client's identity
  headers onto another client/account sharing the server; gate `anthropic-beta`
  by model instead
- **Antigravity**: drop retired Gemini 3.0 quota tiers, show Gemini 3.6 Flash
  usage bars
- **Cloudflare AI**: declare API key authentication (dashboard showed "No
  connections" despite an active key)
- **GitHub Copilot**: hold monthly-exhausted accounts until UTC month reset
  instead of only cooling down 120s
- **CodeBuddy**: dodge Tencent CN content filter, add usage tracking, normalize
  codebuddy-intl messages
- **Usage**: stop losing cached prompt tokens in the forced-SSE→JSON path
- **Grok CLI**: display the public subscription tier from the OAuth token claim
- **Providers**: count apikey connections for Ollama free-tier card; free-tier/
  apikey providers without `authModes` now default to apikey (were treated
  oauth-only)
- **Build**: include static/public assets in standalone output (login page hung
  on 404s when run via PM2)
- **Server**: support IntelliJ IDEA OpenAI-compatible clients over HTTP (h2c
  upgrade handling)
- **Auth**: redirect already-logged-in sessions away from `/login`
- **CLI tools**: enable Apply button for dynamic OpenAI/Anthropic-compatible
  provider connections
- **CLI**: include complete API artifacts in the CLI package
- **TTS**: a bare self-hosted model name is the MODEL, not the voice — `kokoro`
  was parsed as a voice against a default model, 404ing or synthesising with the
  wrong one
- **Embeddings**: self-hosted embeddings no longer fall back to `api.openai.com`
  when a connection has no `baseUrl` — that silently sent the input text and API
  key to OpenAI under a provider named "Self-hosted"
- **Embeddings**: an adapter that rejects a misconfigured connection now returns
  400 with the reason instead of escaping the handler uncaught
- **Embeddings**: bound the upstream fetch with `FETCH_CONNECT_TIMEOUT_MS` — an
  endpoint that drops packets never returns headers, so the request previously
  hung indefinitely

## Docs
- **i18n**: fix port typo, add RTK Token Saver feature descriptions

# v0.5.45 (2026-07-30)

## Features
- **TTS**: add Xiaomi MiMo text-to-speech (preset voices 冰糖/茉莉/苏打/白桦/Mia/Chloe/Milo/Dean, style control, language hint dropdown with Auto-detect, i18n for Style label/placeholder)
- **Providers**: add Poolside (OpenAI-compatible)
- **Providers**: add api-airforce, baidu, bazaarlink, bluesminds, kilo-gateway, llm7, morph, sambanova, tencent
- **OAuth**: zed / trae / windsurf providers + harden callback proxies
- **CLI tools**: set Claude Code max context tokens
- **Qoder**: PAT auth + refresh model list
- **Gemini**: Gemini 3.6 Flash tier routing + Gemini 3.5 Flash Lite
- **Claude**: bump default Opus to `claude-opus-5`
- **Kiro**: add Claude Opus 5 models
- **Usage**: Kimi and DeepSeek usage handlers
- **Usage**: SuperGrok weekly pool via gRPC-web

## Fixes
- **Refresh**: rotate `refresh_token` between retry attempts
- **Kiro**: canonicalize tool history and route API keys correctly
- **Kiro**: normalize dashboard thinking intensity models
- **Cursor**: stop leaking agent tool errors as text
- **Gemini**: fill empty tool schemas after `$ref` strip
- **Antigravity**: strip `stream_options` from non-stream requests
- **Jina-reader**: recover after transient errors, use JSON POST API
- **Usage**: record exact embedding tokens
- **Tunnel**: preserve successor cloudflared PID
- **Console-log**: initialize capture at server boot + prevent SSE proxy buffering
- **Dashboard**: count dual-auth, free-tier OAuth and API-key connections correctly
- **Dashboard**: flex quota rows, thin global scrollbars, no hidden-row overflow

## Docs
- **i18n**: expand pt-BR translation to 986 terms
- README: Indonesian translation

# v0.5.40 (2026-07-20)

## Features
- **i18n**: add Khmer (km) translations
- **CLI tools**: configure Grok Build subagent models
- **Kimi**: merge OAuth into dual-auth provider, add K3 / K2.7 models
- **Dashboard**: ProviderTopology flow animation

## Fixes
- **DB**: resolve better-sqlite3 parameter binding crash
- **Translator**: pass `service_tier` through OpenAI → Responses conversion
- **Kiro**: map GPT-5.6 reasoning effort fields
- **Kiro**: validate terminal streams before emitting output
- **Kiro**: map GPT reasoning effort fields
- **Codex**: current `client_version` + refresh-aware model sync
- **Alicode-intl**: split into Coding Plan + Model Studio providers
- **Cursor**: HTTP/2 AgentService support + version bump 3.12.17
- **Dashboard**: cut duplicate API/icon spam, lazy-load provider assets


# v0.5.35 (2026-07-16)

## Features
- **xAI**: Grok Imagine video generation (`/v1/videos`) + CLI
- **CLI tools**: Grok Build setup — choose separate main/general-purpose/explore/plan models and preserve each model's context window
- **GitHub Copilot**: route Claude models through Copilot's native `/v1/messages`
- **Kiro**: add GPT-5.6 model family (#2596)
- **RTK**: `X-9Router-Token-Saver` header to bypass token savers per request
- **Providers**: quota visibility settings
- **Translator**: drop temperature for all Claude models
- **i18n**: Thai (th) + Persian (fa) translations / README

## Fixes
- **Providers**: bulk-add API keys no longer overwrite existing keys (gap-fill `Key N`)
- **Anthropic**: lowercase `anthropic-version` header to prevent duplication on `/v1/messages`
- **Alicode-intl**: use DashScope compatible-mode endpoint so standard keys work
- **Grok CLI**: align Grok Build with current subscription protocol (#2590)
- **Grok CLI**: surface `expiresAt` so proactive token refresh fires (#2546)
- **Kiro**: improve direct session cache reuse
- **Models**: populate capabilities for live-catalog LLM models
- **Models**: list compatible provider models in `/v1/models`
- **Thinking**: send explicit `thinking:{type:adaptive}` alongside `output_config.effort`
- **Translator**: strip `client_metadata` when converting openai-responses → openai

## Improvements
- **Perf**: skip inactive background services on startup

## Docs
- README: Persian YouTube tutorial

# v0.5.30 (2026-07-10)

## Features
- **Perplexity**: add Agent API provider (#2492)
- **Grok CLI**: add Grok CLI / Grok Build provider with OAuth device-code flow (#2502)
- **Featherless**: add OpenAI-compatible provider presets
- **SearXNG**: configure endpoint via SEARXNG_URL env (#2499)
- **Providers**: add max thinking level for gpt-5.6-sol (#2500)
- **Headroom**: add extras detection and install UI (#2403)
- **Headroom**: activate/uninstall extras + fix interpreter detection
- **PXPipe**: PXPIPE token saver — multimodal prompt compression (#2465)
- **Proxy-Pools**: auto-rotate strategy for no-auth providers (#2409)

## Fixes
- **Cloudflare-AI**: support accountId in bulk key import (#2449)
- **DB**: backup on schema change, MCP child cleanup, codex models, usage providers OOM
- **Codex**: avoid bare-email OAuth dedup (#2477)
- **CLI**: allow staged app bundle builds (#2479)
- **Headroom**: compress Kiro conversation state (#2488)
- **Gemini-CLI**: raise output floor for thinking and add validated toolConfig (#2486)
- **GitHub**: label Copilot profiles by account identity (#2498)
- **OpenAI-to-Claude**: unwrap bare {function:{…}} tools without parent type (#2473)
- **Translator**: clamp thinking effort max->xhigh for OpenAI format (#2466)
- **RTK/find**: detect and group Windows backslash-style find output (#2448)
- **Codex**: handle fast tier and capacity SSE (#2452)
- **Volcengine-ark**: clamp Kimi max_tokens to 32768 endpoint cap
- **Antigravity**: align provider fingerprint with IDE Desktop 2.1.1 (#2389)
- **Pricing**: update Claude/Codex model rates and add new models

## Improvements
- **i18n(zh-CN)**: complete Chinese translations for all UI strings (#2436)
- **API**: caching for tunnel and version status endpoints
- **Perf**: faster dev startup and lighter bundle

# v0.5.20 (2026-07-07)

## Features
- **Thinking**: per-model thinking level picker on provider page — appends `(level)` suffix to copied model names for forced reasoning effort across all formats (openai, claude, gemini, deepseek, kimi, qwen, zai, minimax, hunyuan, step)
- **RTK**: add JS-native git-log filter (#2423)
- **Caveman**: add targeted upstream-aligned style rules (#2424)
- **i18n**: add Farsi (fa) language support (#2385)

## Fixes
- **Thinking**: strip `(level)` suffix from upstream `body.model` so providers no longer reject requests
- **Translator**: preserve developer instructions in openai-responses conversion (#2434)
- **count_tokens**: count structured Anthropic blocks (#2419)
- **Volcengine-ark**: clamp GLM-5 max_tokens to model output ceiling (#2428)
- **Kimi**: normalize reasoning_effort to backend enum (#2427)
- **Claude**: reconcile max_tokens vs thinking budget and lift per-model ceiling (#2381)
- **Kiro**: deliver system prompt natively, add Opus 4.5/4.7/4.8, tolerate dash version ids (#2366)
- **Headroom**: proxy dashboard through app (#2372)
- **MITM**: recover from stale lock file on server start

# v0.5.18 (2026-07-03)

## Features
- **Usage**: track cached tokens + correct input/output/cache cost (#2209) — hodtien
- **Codex**: show reset credit expiry details (#2290) — Rafli Ahmad Zulfikar
- **NVIDIA**: add new models and capabilities — decolua
- **ClinePass**: add provider support — sternelee

## Fixes
- **Usage**: dedupe streaming request-details log entries — Qin Li
- **Claude**: drop foreign thinking signatures in passthrough — decolua
- Prevent non-SSE stream pipe crash and cross-IdP account overwrites (#2244) — KunN-21
- **Kiro**: route IdC auth to regional CodeWhisperer surface (#2297) — Volodymyr Saakian
- **Kiro**: add Claude Sonnet 5 model support (#2264) — Edison42
- **Xiaomi-tokenplan**: region selector, key validation, multi-connection (#2251) — MiQieR
- **Translator**: strict Anthropic content block compliance (#2225) — Sahrul Ramadhan Hardiansyah
- **Kimchi**: strip reasoning_content echo to bound multi-turn input tokens — KunN-21
- **Kimchi**: bump User-Agent to kimchi/0.1.40 (#2256) — Ansh7473
- **Codebuddy-cn**: strip empty tool_calls arrays to preserve reasoning — zmf
- **Antigravity**: preserve Claude tool delta index (#2223) — Sutarto Jordan Chrisfivo
- **MITM**: generate root CA on server startup (#2228) — Sutarto Jordan Chrisfivo

# v0.5.15 (2026-06-29)

## Features
- Add Kimchi OAuth provider — Nant361
- Refine Qwen vision/video + thinking model patterns — decolua
- Opt-in Codex auto-ping quota keep-alive — Emirhan

## Fixes
- **Responses**: handle response.done terminal events (#2142) — rifuki
- **Headroom**: skip unsafe responses tool history (#2132) — Sutarto Jordan Chrisfivo
- **Translator**: map mid-conversation system message to user (claude→openai) — decolua
- **Gemini**: normalize contents to prevent 400 invalid_argument (#2192) — warelik
- **Gemini**: backfill thoughtSignature + suppress stream done sentinel — WARELIK
- **Alicode**: preserve cache_control for DashScope providers (#2069) — Rex
- **Antigravity**: strip deprecated/readOnly/writeOnly from tool schemas — iletai, Yudhistira-Official
- **CodeBuddy CN**: show bonus packs as one-time, not monthly-replenishing — whale9820
- **Kiro**: strip leaked <thinking> tags from content stream (#2158) — hamsa0x7
- **Tray**: make Windows context menu DPI-aware — Emirhan
- **Kilocode**: expose full gateway catalog in combo model picker — jellylarper
- **OpenCode**: fix Go GLM — decolua

# v0.5.12 (2026-06-26)

## Features
- Add token-saver dashboard page — decolua
- Add bulk delete for provider connections — teddytkz
- Resolve GitHub Copilot model catalog from upstream — caiqinzhou
- Add Venice AI provider — Brokenc0de
- Add Kiro external_idp import for Microsoft SSO (CLIProxyAPI) — Stevanus Pangau
- Overhaul Blackbox provider catalog + WebUI test support — suryacagur

## Fixes
- Provider thinking compatibility (DeepSeek/Gemini) — Mink Nguyen
- Stop double-counting streaming usage at source — decolua
- Usage logging dedupe to reduce stats churn — Mink Nguyen
- Prevent non-JSON SSE lines / duplicate [DONE] from breaking clients (PR #2046) — qianze
- Resolve Gemini TTS models from catalog — nguyenha935
- Support Kiro IDC (organization) token import — quanturbo
- Preserve forced streaming for JSON clients (#2031) — Joseph Yaksich
- Preserve Responses text format (Codex) — tenglong
- Support Gemini native TTS generateContent endpoint — nguyenha935
- Add missing zh-CN endpoint key label (i18n) — weimaozhen
- CodeBuddy: only send reasoning params when client requests reasoning (#2071) — Rex
- CodeBuddy CN: show one-shot bonus packs as expiring, not monthly-replenishing
- Show custom provider models in combo picker — Sapto
- Docker: add docker-compose.yml with headroom enabled by default — nitsuahlabs
- Clarify token diagnostics vs provider billing (headroom, #1998) — Sutarto Jordan Chrisfivo
- Translate openai-responses input through OpenAI for compression (#1998) — Ankit
- Kiro: report 1M context window for claude-opus-4.8 — EdisonPVE
- Avoid stale redirects after auth changes (#2100) — Emirhan
- Mark Claude Opus 4.7 (dashed id) as 1M context — Brokenc0de
- Preserve reasoning effort through Codex translations — ntdung6868
- Token-saver: full width card layout — decolua
- Antigravity: retry transient upstream failures — Sutarto Jordan Chrisfivo
- Param-support: handle strip rules without match/drop (#1960) — Joseph Yaksich
- Translator: resolve custom provider prefix in debug endpoint (#1083) — hamsa0x7

# v0.5.8 (2026-06-21)

## Features
- **Antigravity**: native image generation support (image models tagged kind:image, hiển thị trong media-providers UI)
- **CodeBuddy CN**: API key auth + credit quota tracker
- **CodeBuddy CN**: short model prefix alias "cbcn"

## Fixes
- **MiniMax-M3**: enable vision capability
- **Headroom**: support Docker sidecar proxy
- **Antigravity**: image executor fixes
- **mimo-free**: Chrome User-Agent rotation to bypass anti-abuse gate
- **cloudflare-ai**: flatten content-part arrays to string to avoid oneOf 400 (#1926)
- **Translator**: normalize tools to Anthropic-native shape for non-Anthropic providers
- **CLI**: handle Next.js 16 nested standalone output path (#1940)
- **Codex**: preserve custom tools during request normalization
- **next.config**: add new route for responses endpoint to API

# v0.5.6 (2026-06-20)

## Features
- **Ponytail**: minimalist code generation feature
- **Headroom**: proxy lifecycle management + dashboard UI (one-click start/stop, install detection, status probing, token saver, claude↔openai shape conversion)
- **CodeBuddy CN**: new OAuth provider (copilot.tencent.com) — 15-model catalog, /v2 inference, forced streaming, OpenAI-style reasoning
- **OpenCode-Go**: align models with official endpoints; route Qwen 3.7 MiniMax via /v1/messages, GLM/Kimi/DeepSeek/MiMo via /chat/completions

## Fixes
- **Anthropic-compatible validation**: use POST /v1/messages (GET /models not spec, false "invalid" for valid keys)
- **CLI tools**: tolerate JSONC configs in all 8 settings routes (opencode, openclaw, kilo, droid, cowork, copilot, claude, cline)
- **Gemini/Antigravity**: preserve 'pattern' in tool schema translation (glob/grep)
- **Combo/Fusion**: flatten Anthropic-style tool messages in panel calls (prevent 503)
- **Models**: store provider custom models by provider scope
- **Perplexity**: use /v1/models endpoint for key validation

# v0.5.4 (2026-06-18)

## Fixes
- **Kiro**: honor thinking effort budgets
- **AG/Kiro/Xiaomi**: provider fixes
- **Combo/Fusion**: flatten tool history in panel calls to prevent 503
- **LLM selector**: show custom vision models in selector and model list
- **Image**: prevent compatible nodes from shadowing provider aliases

# v0.5.2 (2026-06-17)

## Features
- **Combo Fusion strategy** — fans the prompt out to all member models in parallel, then a configurable judge model synthesizes one final answer (quorum-grace, anonymized sources, graceful degradation)
- **Per-combo strategy selector** — pick `fallback` / `round-robin` / `fusion` / `capacity` per combo (replaces the old round-robin toggle), with a judge picker for fusion
- **Capacity auto-switch** — reorders models per request so images/PDFs route to capable models first
- **Kiro headless API-key auth** (`ksk_`) + direct `claude↔kiro` route that avoids the lossy OpenAI two-hop pivot
- **Claude auto-ping** — warms the 5h quota window right after reset so a fresh window starts immediately (per-connection toggle)

## Fixes
- **Claude 429**: stop hammering the OAuth usage endpoint — cache resetAt, throttle quota refresh to 3 min, cool down after a 429 (chat unaffected)
- **Usage logs always empty**: missing `await` on `getAdapter()` in `getRecentLogs` made `/api/usage/logs` & `/api/usage/request-logs` return nothing
- **Executors**: strip params unsupported by the provider/model (drops deprecated `temperature` for claude-opus-4 → Anthropic 400)
- **Translator**: derive deterministic tool_call ids for gemini/antigravity → OpenAI so function call/response pair correctly (fixes tool-pairing 400s)
- **Antigravity**: strip `optional` from tool schemas before sending to Gemini
- **Claude-to-OpenAI**: handle OpenAI-format responses in the non-streaming path (e.g. xiaomi-tokenplan)
- **Usage views**: show edited connection names consistently across Providers & Quota Tracker
- **Security**: hardened reverse-proxy local-access trust
- **Security**: SSRF hardening on web fetch

## Internal
- Large **open-sse / translator refactor** (~40 commits): unified provider/model registry (LiteLLM-style `models[]` + `kind` field, 100 co-located registry files), single-sourced media/OAuth/refresh/token URLs, registry-based dispatch for usage & token-refresh, DRY translator concerns (buildUsage, encodeDataUri, finishReasonMap, chunkBuilder, reasoningDelta…), ESM-safe registry init, large-file splits, dead-code removal, and golden/no-regression test gates

# v0.4.80 (2026-06-13)

## Features
- Vercel AI Gateway: support embeddings, images and credit usage (#1183)
- Add MiMo Free no-auth provider (#1789)
- Vertex: support ADC `authorized_user` credential
- Cowork: re-enable Claude Cowork with preset-only stdio MCP
- Codex: bulk add accounts via JSON (#1719)
- Kiro: enable multi-endpoint failover for GenerateAssistantResponse (#1722)

## Fixes
- Security: re-auth on DB export/import + SSRF guard on web fetch
- Auth: real client IP rate-limiting + remote default-password guard
- Cerebras/Mistral: strip unsupported `client_metadata` from downstream requests (#1742)
- SiliconFlow: update baseUrl `.cn` -> `.com` + curate verified model list (#1760)
- Gemini-to-OpenAI: route unsigned thought parts to `reasoning_content` (#1752)
- Claude-to-OpenAI: strip Anthropic billing header from system prompt (#1765)
- Anthropic-compatible: send Bearer auth for third-party gateways (#1795)
- Usage-stats: avoid partial stats on initial SSE race (#1767)
- Proxy: use `export default` in proxy.js for Next.js 16 middleware detection
- Claude passthrough: add body normalization
- GitHub Copilot: refresh missing/expired token on models discovery (#1727) + add mappable gpt-5-mini/gpt-5.4-nano slots for Copilot MITM (#1653)
- Kiro: auto-resolve profileArn to prevent 403 on IDC login, enhance profile ARN resolution, update endpoint to `runtime.us-east-1.kiro.dev` (#1713)
- Tunnel: detect system-installed Tailscale via dual-socket probe (#1723) + non-blocking probes to prevent UI freeze
- CommandCode: force `stream=true` in transformRequest (#1706)
- Qoder: increase timeouts for reasoning models and improve stream handling
- Dashboard: show provider node name instead of connection name in topology (#1770) + show explicit `kind="llm"` combos on combos page (#1684)

## Docs
- README: add Indonesian 9Router tutorial video (#1709)
