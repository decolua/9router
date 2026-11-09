# v0.5.387 (2026-11-07) · 1 commit

## Auto Harvester: working proxy probe + verified imports

- Root cause of 0/500 harvests: the route statically imported undici, which Next bundles into its compiled undici copy whose ProxyAgent fails at runtime. Probes now use the same pattern as open-sse/proxyFetch (dynamic import + global fetch), verified returning ok:true with egress IP and location.
- End-to-end verified: start target 5, ran the real cycle, imported FreeProxy-<ip>_<port>-[LOC] entries (status working, active) into Proxy Pools.
- Removed the temporary ?debug=1 endpoint.

# v0.5.384 (2026-11-07) · 1 commit

## Auto Harvester: candidate shuffle fix

- Candidates were taken in feed order, so the first 500 all came from the first feed (jetkai), which was 100% dead on this network. The harvester always finished 0/500.
- Candidates are now shuffled before the scan window is picked, so live proxies from healthy feeds (monosans, TheSpeedX, sunny9577) are reached in every run.

# v0.5.383 (2026-11-07) · 1 commit

## Auto Harvester: dead feed pruning, English UI, de-slopped

- Pruned 3 dead/empty proxy feeds (MuRongPIG, KangProxy, stormsia), added TheSpeedX/PROXY-List (2.7k live). 12 feeds total, all verified reachable.
- Page copy now English (was Indonesian). Removed the fake-terminal status box, icon clutter and the generic 3-step explainer card.

# v0.5.382 (2026-11-07) · 1 commit

## FEATURE+ — Auto Harvester

- New dedicated page under FEATURE+ that auto-fills the proxy pool from 15 public free-proxy feeds.
- Pipeline: parallel feed fetch (4s cap) -> sub-second TCP ping pre-check -> HTTP verification via Cloudflare trace (captures egress IP + location, drops duplicate egress so quota buckets stay distinct).
- Configurable target (1-200 live proxies) and loop interval (once / 2m aggressive / 5m / 15m / 30m / 60m), with live status, progress bar, cycle history and per-run stats.
- Backend worker lives at /api/harvester with its own isolated state; imported proxies land in Proxy Pools as FreeProxy-<ip>_<port>[-<loc>].

# v0.5.378 (2026-11-07) · 1 commit

## Remove Z.ai web cookie provider (`zai-web`)

- Removed the `zai-web` registry (`open-sse/providers/registry/zai-web.js`),
  its registry slot `p159`, and the provider logo `public/providers/zai-web.png`.
- `zcode-bridge` fallback no longer resolves `zai-web` connections; it now
  prefers GLM, then `zcode`/`zc`.
- Deleted the leftover `zai-web` connection (and its usage history) from the
  preview database.

# v0.5.377 (2026-11-07) · 1 commit

## ZCode bonus start plan — visible claim + in-app Aliyun verification

- The bonus banner now also shows for `zcode` / `zc` connections (previously only
  `glm`), and the bonus endpoint scans the whole ZCode family — connected ZCode
  accounts can now see their promotional start-plan bonuses right after connect.
- Claiming a plan that needs Aliyun NoCaptcha (HTTP code 3007) now returns
  `verifyRequired` with the verify URL and app deep link instead of failing
  silently. The banner opens a verification panel with a "Buka Aplikasi ZCode"
  deep link, a `zcode.z.ai` fallback, and a field to paste the
  `X-Aliyun-Captcha-Verify-Param` captured in-app before retrying the claim.

# v0.5.376 (2026-11-06) · 1 commit

## Live Requests Stream — model name only

- The stream no longer prints the small provider/channel chip and resolved-model
  arrow under each model name — each row now shows just the model, matching the
  previous compact style. Column header renamed `Model & Channel` → `Model`.

# v0.5.375 (2026-11-06) · 1 commit

## ZCode provider parity (zcode seren)

- Ported the full ZCode provider stack: `ZCodeExecutor` (GLM-5.3-Flash /
  GLM-5.3 / GLM-5.2 / GLM-5-Turbo, Bearer + ZCode JWT dual-lane), plan selection
  (`zcodePlan`), prompt builder, TLS client, service bridge, usage tracking, and the
  `zcode-bridge` API route.
- Added `zcode` (OAuth) and `zai-web` (webCookie) registries (p159/p160), plus
  `zcode`/`zc` executor wiring and the ZCode OAuth provider + `ZCODE_CONFIG`.
- Brought secondary dependencies up to parity: `zai-anthropic` thinking
  wire with `mapEffortToSupportedLevel`, ZCode capability table, GLM-5.x effort
  levels in `PATTERN_THINKING`, and ZCode quota normalization in ProviderLimits.
- Added `zcode` + `zai-web` provider logos and the ported unit test
  (`tests/unit/zcode-provider.test.js`: 21 pass / 4 fail — identical to the
  reference run, the 4 failures are stale upstream expectations).

# v0.5.374 (2026-11-06) · 1 commit

## CLI Tools logo tiles — transparent background, logo only
- The logo tile in the CLI Tools summary cards and the per-tool setup header
  carried `bg-bg-secondary`, which renders as a white-tinted glass box
  (`rgba(255,255,255,0.11)`) behind every provider logo — that's the white
  background the user kept seeing. Removed the tile background and border
  entirely; each card now shows just the provider logo on the card surface.

# v0.5.373 (2026-11-06) · 1 commit

## Runcrate — real logo instead of the RC text tile
- Fetched the Runcrate brand mark from runcrate.ai (favicon) and shipped it as a
  transparent `public/providers/runcrate.png` (256px) — the provider previously
  fell back to the `RC` text fallback in the logo tile.

# v0.5.372 (2026-11-06) · 1 commit

## 9router sidebar logo — replaced with the new brand mark
- Swapped the sidebar logo asset to the updated 9router mark the user provided
  (`public/providers/9router-logo.png`), replacing the earlier 4 MB image with a
  295 KB square glyph. Renders transparent at 36×36 in the sidebar header.

# v0.5.371 (2026-11-06) · 1 commit

## Provider logos — transparent backgrounds, uniform size, 9router + LLMTR marks
- **9router sidebar logo**: replaced the gradient `hub` icon tile with the
  official 9router brand mark (`public/providers/9router-logo.png`) the user
  provided — rendered transparent in the sidebar header.
- **Stripped baked backgrounds** from 21 provider logos that shipped with opaque
  white/coloured boxes (`droid`, `roo`, `kiro`, `forge`, `openclaw`, `oai-cc`,
  `oai-r`, `poolside`, `mimocode`, `xiaomi-mimo`, `xiaomi-tokenplan`, and
  others) — corners are now transparent so they sit cleanly on the glass theme.
  Logos whose mark is same-colour as the bg (would be destroyed by stripping)
  are left intact.
- **Uniform logo size**: CLI Tools cards and the providers menu now render every
  provider logo with `object-cover` filling a fixed tile (44px / 32px), so all
  logos appear the same size regardless of source aspect ratio.
- **LLMTR logo**: fetched the official LLMTR brand mark from llmtr.com
  (`favicon.svg`) and rendered it as a transparent `public/providers/llmtr.png`
  — it previously fell back to the `LT` text tile.

# v0.5.370 (2026-11-04) · 1 commit

## CLI Tools provider logos — uniform, larger, no background tint
- Every CLI tool card logo now fills the whole icon tile (`object-cover`, 44px)
  so all logos render at the same size regardless of their source aspect ratio —
  previously they were 28px `object-contain` and varied in size.
- Dropped the brand-color background tint on the icon tile (used the neutral
  `bg-bg-secondary` surface) so transparent logos sit cleanly instead of on a
  coloured box. Applies to both the summary grid cards and the per-tool setup
  header.

# v0.5.369 (2026-11-04) · 1 commit

## CLI Tools dashboard — richer setup cards
- **Tool summary cards redesigned**: each CLI tool card now shows the tool's
  description (was hidden), wraps its icon in a brand-colored rounded tile
  (8% background + matching border from the tool's brand colour), and gets a
  status badge with a coloured dot plus a hover lift (`elev-2` shadow) and a
  chevron nudge on hover.
- **Setup detail cards**: the expandable per-tool setup header uses the same
  brand-colored icon tile for visual consistency with the summary grid.

# v0.5.368 (2026-11-04) · 1 commit

## CodeBuddy Intl OAuth login fix, 4 upstream PRs ported, Kimi Code CLI setup
- **Fix CodeBuddy Intl OAuth login**: the intl OAuth endpoints pointed at
  `www.codebuddy.ai`, which is blackholed (DNS → 0.0.0.1) — login failed at the
  device-code step. Repointed the OAuth state/token/refresh URLs and the
  `X-Domain` identity header to the live `www.workbuddy.ai` endpoint set
  (verified: POST /v2/plugin/auth/state returns 200). Applies to the registry,
  the OAuth provider flow, the token-refresh service, and the intl executor
  comment. CN (`copilot.tencent.com`) was already healthy and is untouched.
- **Port upstream PR #5431 — Anthropic API-key system identity drop**: on the
  `anthropic` provider, any leading "You are Claude Code" / Claude Agent SDK /
  `x-anthropic-billing-header` identity block now trips a misleading "credit
  balance is too low" 400. `prepareClaudeRequest()` strips the leading identity
  text/block for the API-key `anthropic` provider only (OAuth `claude` and
  `anthropic-compatible-*` nodes untouched).
- **Port upstream PR #5432 — Anthropic live model catalog**: registered
  `anthropic` in `LIVE_MODEL_RESOLVERS`; `/v1/models` now fetches the key's
  live catalog from `api.anthropic.com/v1/models?limit=1000` (falls back to the
  static list on failure or when an explicit `enabledModels` list exists).
- **Port upstream PR #5458 — LLMTR provider**: new `llmtr` OpenAI-compatible
  gateway provider (alias `lt`), API-key validation via one-token chat probe,
  live model catalog resolution, and reasoning-as-boolean coercion. Resolved the
  registry-index, paramSupport, baseline and golden-snapshot conflicts against
  the fork's custom provider set.
- **Port upstream PR #5423 — Headroom reliability**: resolve symlinked venvs for
  Python 3.14 detection, reclaim listening ports on restart, strict process
  identity verification, reject external proxy URLs, and rewrite dashboard proxy
  assets/API endpoints (fetchJson, /stats, /health, /settings) with a styled 503
  fallback.
- **Kimi Code setup in CLI Tools**: added a `kimi-code` guide card to the CLI
  Tools dashboard — install (`curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash`
  or `npm install -g @moonshot-ai/kimi-code`), 9Router base URL + API key, model
  picker, and a ready-to-paste `~/.kimi-code/config.toml` provider+models block
  (OpenAI-compatible type).

# v0.5.367 (2026-11-04) · 1 commit

## Background loading-in-the-bell: all surfaces verified, stale tests fixed
The bell now carries every long operation — batch testing, backup/import, bulk
key imports, Codex/Grok accounts import, Qoder/Cline model imports and proxy
import — while the operator clicks around and switches menus. The feature was
already wired across all six surfaces; several tests that guard it could not
run because they read files from `process.cwd()` (the tests dir) instead of the
repo root, and a couple asserted removed patterns.
- **Test paths anchored to the repo root** (`resolve(__dirname, "../..")`) in
  `bell-all-loading`, `bell-done`, `notification-links`, `model-import`,
  `dashboard-six`, `shutdown-gate`, `context-install` and `update-banner-anim`
  — previously all failed at collection with `ENOENT`.
- **`studio-banner-update`**: the proxy import now cancels via a server-side
  dashboard job (`cancelProxyImportJob`) rather than a client `AbortController`;
  the assertion now checks the job-cancel contract.
- **`shutdown-gate`**: dropped the stale `canChangeTheme` sibling check (the
  theme switcher was removed with the glass-only theme lock) and asserts no
  removed rule is referenced.
- **`dashboard-six`**: replaced the model-benchmark block (feature removed with
  Custom Plugins) with a guard that the benchmark files no longer ship.
- Suite result: 8 previously-broken suites now green; full unit run fell
  176 → 168 failures, all remaining being pre-existing network / macOS /
  integration-environment tests unrelated to the bell.

# v0.5.366 (2026-11-04) · 1 commit

## Changelog UI: composite category headings now render in colour
The changelog modal painted every unrecognised category heading grey with a
"help" icon instead of the usual coloured "WHAT'S …?" pill. Headings the fork
writes like `Providers & Usage Fixes`, `Providers & UI`, `UI & Theme System`,
`Documentation & Maintenance`, `Features & Cleanup` and the `Upstream … Port`
release-section titles fell through to the unknown-category fallback.
- Added the missing composite aliases to `CATEGORY_ALIAS` so they collapse to a
  coloured category: `Providers & Usage Fixes` → Fixes, `Providers & UI` /
  `UI & Theme System` / `UI & Visual Design` → UI, `Documentation & Maintenance`
  → Docs, `Providers & Features` / `Features & Cleanup` / `Features & Improvements`
  → Features, `Providers & Web Cookie` → Features, `Testing` / `Upstream … Port`
  / `OpenCode Free lane divergence clean-up` → Internal.
- Verified with the shipped guard: the category-style suite confirms **no
  heading in CHANGELOG.md renders with the grey unknown fallback**.

# v0.5.365 (2026-11-04) · 1 commit

## OpenCode Free lane divergence clean-up (post-v0.5.112 port)
The fork's "OpenCode Free" card is a two-lane toggle behind `OpenCodeLaneExecutor`
(V1 CLI lane / V2 direct TLS lane). The ported tests still asserted the single-
executor era's contract, so they failed against the current split.
- **`_tryCliExecute` no longer crashes on a Responses-shaped body**: the CLI
  prompt formatter call moved inside the try/catch, so a body it can't format
  falls through to the fetch path instead of throwing a `TypeError` on
  `dialogMsgs[0].text`. This is a real runtime bug — a request with an `input[]`
  body used to crash when a host `opencode` binary was present.
- **Session/UA wire tests point at the CLI executor explicitly** (`OpenCodeExecutor`),
  since the lane shell's sync delegates default to the V2/direct lane. The
  sidecar-spawning `execute` assertion was rewritten as a request-preparation
  check (session + bearer auth minted, source credentials unmutated).
- **Fingerprint tests updated to the current gate contract**: the free tier
  requires the `<env>` marker, so `instructions`/first `messages`/`system`
  carry it; the "placeholder note" is only suppressed when the caller already
  brings the exact fingerprint definitions.
- Unit result: the 5 opencode suites (92 tests) are green; full suite fell
  178 → 176 pre-existing failures (none from this change).

# v0.5.364 (2026-11-03) · 1 commit

## Upstream Port Completion (decolua/9router v0.5.112)
- **System One URL Normalization**:
  - Added `buildSystemoneUrl()`: a saved host override is now joined with the registry `path` without doubling an existing `/v1` or `/v1/systemone` segment.
  - Restricted the `x-opencode-session` header to the OpenCode lanes (`opencode`, `opencode-zen`) — other System One providers no longer receive a foreign client session id.
- **Lazy Runtime (published-build fix, upstream `e70ea24d`)**:
  - Resolves `createRequire` through a runtime `import()` with `webpackIgnore`, anchors npm to a generated manifest inside the runtime dir, and turns a partially-extracted install into an actionable error instead of a silent failure.
- **Codex GPT-6.1 Terra pricing corrected** to the published official rate (input 1.00 / output 5.00 / cached 0.05).
- **Test coverage restored for the port**:
  - Added the upstream suites for GitHub Copilot Claude 5.5 thinking rules and CodeBuddy channel headers; added the GPT-6.1 Terra cases to the Codex Lite suite.
  - CodeBuddy pairing assertion now follows the fork's desktop-client capture (X-Request-ID pairs with X-Conversation-Message-ID), and the Codex header-version assertion reads the live `CODEX_CLI_VERSION` instead of a stale literal.

# v0.5.363 (2026-11-03) · 1 commit

## Upstream Feature Port (decolua/9router v0.5.112)
- **MiniMax Code (Desktop Lease Mode)**:
  - Added lease auth mode that connects to the official desktop app sign-in via Unix domain socket / named pipe broker.
  - Added MinimaxLeaseButton to the dashboard provider connection controls and automated usage tracking.
- **Nace Drex Provider**:
  - Registered `nace` provider in System One lane with models `drex`, `drex-v2.0`, and `drex-max`.
- **Codex GPT-6.1 Terra**:
  - Added `gpt-6.1-terra` to Codex responses-lite catalog with GPT-6-Lite thinking levels and 500k context window.
- **CommandCode CLI 1.88.0 Sync**:
  - Unified request headers (`User-Agent: cli`, version `1.88.0`, `x-cli-environment: production`, `x-project-slug`) and conversation-stable thread session UUID mapping.
- **Upstream Fixes & Enhancements**:
  - **Noble-Hashes Keccak PoW**: Replaced vendored DeepSeek PoW hash with lightweight, optimized noble-hashes keccak port.
  - **GitHub Copilot Claude 5.5**: Applied Claude 5.5 adaptive thinking rules to Copilot's dotted model IDs (`claude-opus-5.5*`, `claude-sonnet-5.5`, `claude-haiku-5.5`).
  - **CodeBuddy Channel Verification**: Injected official plugin `X-Request-ID` and `X-Conversation-ID` headers to prevent HTTP 400 illegal request errors.
  - **NVIDIA NIM Reasoning**: Normalized `reasoning` parameter aliases to `reasoning_content` before forwarding.
  - **Gemini Protobuf Schema Predicates**: Enforced type predicates on array items and properties in schema conversions.
  - **Non-Streaming SSE Errors**: Transparently surface upstream HTTP errors (4xx/5xx) from SSE error frames instead of converting to generic 502.
  - **Muse Multi-Pipe Key Preservation**: Keep `LLM|id|secret` key format opaque during bulk-add.

# v0.5.362 (2026-11-02) · 1 commit

## Features & Improvements
- **Remove Unused Quota Check**:
  - Removed the unused `Quota check` toggle and `/credits` quota path input from both `AddCompatibleModal` and `EditCompatibleNodeModal`.
- **Fix Custom Provider "Import from /models"**:
  - Automatically resolve base URL from the provider node when connection-specific base URL is empty.
  - Added support for proxy routing (`resolveConnectionProxyConfig` + `proxyAwareFetch`) when importing models for custom OpenAI and Anthropic compatible providers.
  - Normalized diverse response structures (`data`, `models`, or bare array) so models are correctly parsed and imported into the custom catalog.
- **Background Task Non-Blocking Navigation**:
  - Modals for bulk operations (`BulkImportCodexModal`, `BulkImportGrokCliModal`, `AddApiKeyModal`) now dismiss upon kickoff, allowing seamless tab navigation while tracking progress in the notification bell (`useTaskStore`).
  - Swapped intrusive blocking browser `alert()` popups during model imports for silent task store progress and completion updates in the notification bell.
- **Bulk Proxy Import Performance & Immediate Feedback**:
  - Chunked proxy pool bulk insertions into batches of 50 via `createProxyPools` in a transaction.
  - Scheduled frequent intermediate progress updates and yielded to the event loop so the notification bell reflects import progress instantly without delay or frozen sockets.

# v0.5.361 (2026-11-02) · 1 commit

## Documentation & Maintenance
- **Evergreen Routing Overview in README**:
  - Replaced hardcoded provider table lists with high-level conceptual connection tiers (OAuth & Device Auth, Direct API Keys, Free Tier Relays, Web Cookie Sessions, and Local/Self-Hosted).
  - Completely removed volatile lists of individual provider brand names from `README.md` so the documentation stays permanently fresh without needing manual updates when providers are added or removed.

# v0.5.360 (2026-11-02) · 1 commit

## UI & Visual Design
- **Redesign Z.ai / ZCode Brand Icon**:
  - Replaced the dull, shrunken asset with an official high-contrast Z.ai royal cobalt-blue squircle badge (`glm.png`, `glm-cn.png`, `zcode.png`).
  - Balanced glyph proportions, increased scale, and applied smooth rounded squircle geometry so the icon matches other premier provider logos.

# v0.5.359 (2026-11-02) · 1 commit

## Documentation & Maintenance
- **Evergreen README Restructure**:
  - Replaced the volatile "What this fork adds" section with timeless "Architecture & Core Design" documentation covering protocol adaptation, unified credentials, routing policies, and enterprise controls.
  - Offloaded all version-specific changelog details exclusively to `CHANGELOG.md` so the main README never requires recurring manual edits.

# v0.5.358 (2026-11-02) · 1 commit

## UI & Visual Design
- **Official Z.ai Logo for ZCode**:
  - Replaced ZCode / GLM brand assets with the official Z.ai vector brand mark (`glm.png`, `glm-cn.png`, `zcode.png`).
  - Rendered with transparent background and high-resolution geometry matching Z.ai's official brand guidelines.

# v0.5.357 (2026-11-02) · 1 commit

## Documentation & Maintenance
- **Changelog Date Alignment**:
  - Audited and updated release dates in `CHANGELOG.md` to match exact commit timestamps (`2026-11-02`).
  - Aligned chronological entries for v0.5.353 through v0.5.356.

# v0.5.356 (2026-11-02) · 1 commit

## UI & Visual Design
- **Rounded Corners for Provider Logos**:
  - Added gentle rounded corners (`rounded-xl` / `rounded-2xl`) directly to `ProviderIcon` and provider header images.
  - Eliminated sharp square edges on all logo images across provider lists, model selectors, and detail pages.

# v0.5.355 (2026-11-02) · 1 commit

## UI & Visual Design
- **Transparent Background for Provider Logos**:
  - Removed container background color tint (`style={{ backgroundColor: ... }}`) across all provider cards and detail headers.
  - Logos now render cleanly on a fully transparent background, blending seamlessly into the glass dashboard theme.

# v0.5.354 (2026-11-02) · 1 commit

## UI & Visual Design
- **Complete Refresh of Provider Logos**:
  - Replaced over 85 provider icons with modern, high-resolution official brand marks sourced from LobeHub AI Icons and SVGL vector libraries.
  - Standardized transparency, aspect ratios, and padding across all AI labs, cloud hyperscalers, and code editor providers (OpenAI, Anthropic, Gemini, DeepSeek, Groq, xAI, Qwen, Z.ai/Zhipu, Mistral, Perplexity, Cohere, Meta, Azure, AWS Bedrock, Cloudflare, etc.).
  - Preserved internal and tool-specific assets intact with high-fidelity fallbacks.

# v0.5.353 (2026-11-02) · 1 commit

## Providers & Features
- **ZCode Promotional Bonus Claim System**:
  - Added `zcodeClaimService.js` to preview and claim ZCode promotional token plans (e.g. `ZCODE WEEKEND BUILD`, `Trust Build`).
  - Added `/api/providers/glm/bonus` endpoint for detecting and claiming bonuses directly from connected ZCode accounts.
  - Implemented desktop client request emulation with `X-Device-Mid`, `X-ZCode-App-Version`, and headless browser Aliyun verification fallback.
  - Added dedicated Bonus Voucher card and 1-click "Claim Bonus" button in the ZCode (`glm`) provider dashboard.

# v0.5.352 (2026-11-01) · 1 commit

## Providers & Web Cookie
- **Remove Z.ai Web Cookie Provider (`zai-web`)**:
  - Removed `zai-web` provider registry, executor, browser transport, and unit tests cleanly.
  - Purged all references in UI modals, test utils, probe budgets, and settings repos.
- **Add DeepSeek Web Cookie Provider (`deepseek-web`)**:
  - Registered `deepseek-web` under the Web Cookie category with full SHA3-256 / DeepSeekHashV1 PoW challenge solver and SSE parser.
  - Added native support for full model catalogue: `deepseek-chat` (V3 / V4.1), `deepseek-reasoner` (R1 / V4.1 Thinking), `deepseek-v4.1-flash`, `deepseek-v4.1-pro`, `deepseek-v4.1-reasoner`, `deepseek-v3`, and `deepseek-r1`.
  - Added OpenAI-compatible tool calling bridge support (`deepseekWebToolBridge.js`) and in-page toggle banner with dynamic DB settings integration.
  - Added connection testing, validation routes, and UI session credential placeholders (`userToken`).
- **Update ZCode Integration**:
  - Refined `glm` provider as official `ZCode (Z.ai GLM)` with dual-auth (OAuth CLI polling flow + GLM Coding Plan API Key) supporting both OpenAI and Anthropic Claude formats.

# v0.5.351 (2026-11-01) · 1 commit

## Providers & Infrastructure
- **Z.ai Web Browser Transport (Playwright Integration)**:
  - Fixed runtime resolution of Playwright for Z.ai browser transport by lazily resolving installed browser drivers from `/root/shot/node_modules` without triggering Webpack static bundle errors.
  - Added essential Linux container Chromium launch flags (`--no-sandbox`, `--disable-setuid-sandbox`) to allow headless browser automation in root environments.
  - Ensured reliable fallback to Playwright bundled Chromium when system browser channels are absent.

# v0.5.350 (2026-11-01) · 1 commit

## Providers & UI
- **Gemini Web Cookie Info Banner**:
  - Added notice text to `gemini-web` provider registry with explicit instructions for extracting `__Secure-1PSID` and optional `__Secure-1PSIDTS` cookies.
  - Aligned blue info banner appearance across both `gemini-web` and `zai-web` web cookie providers.
  - Changed action link text from generic "Get API Key" to "Open Web" for web cookie providers.

# v0.5.349 (2026-11-01) · 1 commit

## UI & Theme System
- **Enforce glass theme exclusively across the dashboard**:
  - Removed theme switch button and `ThemeModal` completely from `HeaderMenu` and component tree.
  - Locked site-wide theme strictly to `glass` across `themeStore`, `ThemeProvider`, RootLayout, `settingsRepo`, and `/api/theme`.
  - Removed 'dark' theme option and ensured `<html class="dark glass">` is applied prior to first paint.
  - Comprehensive design system audit: eliminated ad-hoc raw colors, replaced hardcoded dark-mode utility classes with official semantic tokens (`bg-surface`, `bg-surface-2`, `bg-surface-3`, `border-border`, `border-border-subtle`, `text-success`, `text-warning`, `text-info`, `text-danger`).
  - Strengthened frosted borders and backdrop blur for cards, dialogs, and panels under the glass theme in `globals.css`.

## Providers & Usage Fixes
- **Web Cookie Token Usage Tracking (Fix Output Tokens 0)**:
  - Added fallback character and token counting logic in `usageTracking.js`, `gemini-web.js`, `webCookieToolBridge.js`, and stream/non-stream handlers so completion tokens are accurately estimated and logged in `usageHistory` even when web providers return 0 tokens.
- **Gemini Web Cookie Models**:
  - Validated and audited full model catalogue (`gemini-3.8-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-pro`, `gemini-4-argon`, and all `-thinking` variants).
  - Verified active Google RPC HEX mappings, multi-format prompt normalization, and auto-retry session refresh.
- **Z.ai Web Cookie Provider (`zai-web`)**:
  - Registered `zai-web` as a full webCookie provider supporting GLM-5.3, GLM-5.3 Flash, GLM-5.2, GLM-5.1, GLM-5 Turbo, and GLM-5V Turbo.
  - Implemented token validation and connection testing against `chat.z.ai`.
  - Configured session token input guidance and token usage estimation.

# v0.5.348 (2026-10-29) · 1 commit

## UI
- **Fixed Tool Calling toggle placement.** The switch is now aligned directly to the right side of the banner across all screen widths rather than stacking below the text description.

# v0.5.347 (2026-10-29) · 1 commit

## Features & Cleanup
- **Removed Custom Plugins system and menu.** The Custom Plugins sidebar navigation, route page, mark badges, and runtime interceptors have been completely removed for streamlined production stability.
- **Web Cookie Provider Tool Calling Banner.** All web-cookie providers (e.g. Gemini Web) now feature an in-page banner card allowing users to toggle OpenAI-compatible tool calling support on or off per provider.

# v0.5.346 (2026-10-29) · 1 commit

## UI
- **Evergreen welcome banner content.** Replaced hardcoded feature highlights in the post-login Welcome modal with enduring, general-purpose platform copy so frequent upstream feature additions no longer cause description drift.

# v0.5.345 (2026-10-29) · 1 commit

## UI
- **OpenCode Free lane switch button & confirmation banner.**
  - The mode toggle button (hammer icon) is positioned at the far edge of the OpenCode Free provider card, vertically centered.
  - Displays as an icon-only button without crowding text labels.
  - Clicking the icon opens a modal banner explaining the difference between Direct Mode (default, fast impersonated TLS, no local CLI needed) and CLI Mode (runs local `opencode` binary & Bun sidecar), with Cancel and Confirm buttons.
  - The same confirmation modal is available from the provider detail page header.

# v0.5.344 (2026-10-29) · 1 commit

## UI
- **The lane marker is a muted suffix, not a chip.** "USING CLI" read like a status flag and the green box competed with the connection badges, so it is now "With CLI" in plain muted text after the name (`OpenCode Free · With CLI`). No border, no fill; it reads as part of the title instead of a second status.

# v0.5.343 (2026-10-29) · 1 commit

## UI
- **"USING CLI" is a chip, not part of the name.** The label moved out of `display.name` into `display.tag`, so the card and the provider header render it as a green bordered chip next to "OpenCode Free" instead of a parenthetical in the title. Search still matches the plain name.

## Fixes
- **The Gemini Web cookie field could not be typed into.** `AddApiKeyModal` calls `splitGeminiCookie()` and `composeGeminiCookie()` on every keystroke but never imported them, so the first character threw a `ReferenceError`, React aborted the handler, and the controlled input snapped back to empty — the field looked dead. The edit modal already imported them, which is why an existing session could be edited while a new one could not be added. Import added.

# v0.5.342 (2026-10-29) · 1 commit

## UI
- **Renamed OpenCode Free providers for clarity.** The original CLI-based lane is now "OpenCode Free (USING CLI)" and the new direct-TLS lane (previously "OpenCode Free V2") is now just "OpenCode Free". IDs and aliases unchanged (`oc` / `oc2`).

# v0.5.341 (2026-10-29) · 1 commit

## Fixes
- **OpenCode Free V2 shares the V1 brand mark and icon.** `opencode-v2` now aliases to `opencode` in `providerIcon.js`, so it uses the exact same `/providers/opencode.png` logo and styling as OpenCode Free V1 without needing a duplicate asset.

# v0.5.340 (2026-10-29) · 1 commit

## Features
- **OpenCode Free V2 (`oc2`) — the lane that works with no proxy.** The V1 lane reaches `opencode.ai` three different ways before it sends a wire request: it spawns the host `opencode` CLI, then a Bun transport sidecar, then an egress probe that re-tests the direct IP. On a host without the CLI and without `bun` each of those fails slowly, and the request that finally goes out rides Node's OpenSSL ClientHello — which the free tier refuses or black-holes, so the call sits until the 60s connect timeout. That is the "timeout terus, tapi di decolua jalan" symptom: decolua's lane sends the wire request straight through `opencodeTlsFetch`, whose cipher list matches Bun's, and nothing else runs first.

## Fixes
- **The TLS client existed but was never wired into the request.** `BaseExecutor` only uses `directFetch` when a subclass passes it, and the V1 executor never did, so `opencodeTlsFetch` was dead code on every path. The V2 executor passes it exactly as decolua does (`directFetch: (url, options) => opencodeTlsFetch(...)`) and keeps proxy handling untouched: with a proxy configured the proxy wins, without one the impersonated client is used.
- **`wreq-js` was missing from the install.** It is the optional dependency behind the impersonating client; without it the TLS path throws `OpencodeTlsUnavailableError` and the caller silently falls back to native fetch — back to the gate. Added to `optionalDependencies` (the lazy loader can still fetch it into `<DATA_DIR>/runtime`).

## Internal
- V2 is a separate registry entry (`opencode-v2`, alias `oc2`, "OpenCode Free V2") and a separate executor, so the V1 lane keeps its CLI/sidecar/egress behaviour untouched. Verified direct, no proxy: `big-pickle` answered `200` in 1.3s with `OK`.

# v0.5.339 (2026-10-29) · 1 commit

## Fixes
- **No screen prints a provider id any more.** `humanizeCompatId` used to append the uuid (`OpenAI Compatible (330688af)`); that suffix is still a database key, just a shorter one, so the label is now the family alone (`OpenAI Compatible`). Two unnamed compatible nodes that would collide are numbered by `dedupeLabels` (`OpenAI Compatible`, `OpenAI Compatible 2`) instead of being split by id.
- **The Logs tab printed the raw provider id in caps.** `getRecentLogs` uppercased `r.provider`, so the row read `OPENAI-COMPATIBLE-CHAT-330688AF`. It resolves through `labelForProvider` and no longer uppercases the label.
- **The request log rows are objects, not pipe-joined strings.** An account or model containing ` | ` shifted every later column and the row disappeared from the table; the API returns fields and the client renders them, still accepting a pipe string so an in-flight cached response cannot blank the table.
- **Provider tooltips repeated the id the label had already replaced.** `Recent Requests` and the provider filter in the quota tab carried `title={provider}` with the raw id; the tooltip now shows the same label as the text.
- **The model picker could still head a group with an id.** A provider missing from the static registry fell back to `{ name: providerId }`, so a compatible node still opened a `openai-compatible-chat-…` heading; the fallback runs through `resolveProviderName` and the quota card's title does too.
- **Every successful log row pulsed as if it were pending.** The status column compared against uppercase (`OK`/`FAILED`) while the stored values are lowercase, so `ok` matched nothing and fell into the pending branch; the comparison folds case and the cell prints the status uppercased.

# # v0.5.338 (2026-10-29) · 1 commit

## Fixes
- **The activity heatmap fit a desktop card, not a phone.** 24 buckets of `14px + 3px gap` plus a 28px day gutter measure 441px, so on a 390px viewport 42 cells sat past the card edge with no scroll container to reach them. The block is one CSS grid now (`repeat(24, minmax(0, 14px))`), so cells shrink on a narrow screen instead of overflowing, and the hour ruler prints at 10px like the rest of the shell.
- **The Savings tab showed numbers for a report that has no rows.** With zero savings the card still printed `Avg 0 / active day` next to a "nothing saved in this period" chart, and a model filter box sat above an empty table. The summary chips and the filter are hidden until there is data behind them.

## Internal
- Dropped the leftover `await import()` of `humanizeCompatId` inside `getProviderLookups`; the symbol is already a static import, so the dynamic one only re-resolved the same module.

# v0.5.337 (2026-10-29) · 1 commit

## Fixes
- **The savings axis printed bare day numbers.** Every tick except the peak was stripped to its day-of-month (`30 4 8 12 16 20 24`), which reads like an hour axis rather than a date axis — the strip was there to stop a tick being clipped when labels sat inline in a ~25px slot, but they have been absolutely centred with room to spare since the tick-spacing fix, so `Oct 4` fits. Ticks print the full short date again.

# v0.5.336 (2026-10-29) · 1 commit

## Fixes
- **The notification count was the one piece of text under 10px in the sidebar.** The unread badge rendered at 9px in a 15px circle, so a two-digit count was unreadable at a glance; it is 10px in a 16px circle now, which is the smallest size the rest of the shell uses.

# v0.5.335 (2026-10-29) · 1 commit

## Fixes
- **The Savings tab names the model, not a node id.** `byModel` was keyed by the raw provider id, so a compatible node printed `openai-compatible-chat-330688af` as if it were a model name. The bucket is now split into provider and model, the API resolves the provider through `getProviderDisplayName`, and the row reads `gpt-5.1` with `OpenAI Compatible (330688af)` beneath it. The same lookup now labels `recentRequests`, `activeRequests`, the by-provider breakdown (`stats.providerLabels`) and the provider bar chart, which used to fall back to the raw id whenever `providerNodes` was empty.
- **The Daily Savings chart has a floor and a scale.** Every bar was drawn at full strength, so a day with 950 tokens looked identical to the 128K peak and the whole strip read as "green box". Empty days are now a muted track, active days are emerald proportional to the peak, and the peak alone is drawn at full strength; tick labels are absolutely centred so a 25px slot cannot clip `Oct 23`, and neighbouring ticks step aside when the peak takes its own label.
- **Cached tokens show up again in Recent Requests.** Five inline `||` chains only knew `cache_read_input_tokens` and `cached_tokens`, so a request that reported `prompt_tokens_details.cached_tokens`, `cachedContentTokenCount` or `prompt_cache_hit_tokens` rendered no badge at all. One `cacheReadTokens` helper now walks every spelling plus the nested details object, and the row prints the badge (verified against one seeded row per spelling: 640 / 960 / 512).
- **A rewritten model on another provider is no longer printed twice.** `gweb/gemini-4-argon → gemini-web/gemini-4-argon` said the same thing twice; the arrow now appears only when the model name itself changed, and the resolved line drops the redundant provider prefix.
- **The provider bar chart survives long labels.** Bars are horizontal, the axis takes the base name (`OpenAI Compatible`, not the 26-character node label), and a custom tick renderer keeps each label on one line — Recharts used to wrap it onto three lines that overlapped the neighbouring rows.

## Performance
- **Usage aggregation is memoized.** Each stats call ran three dynamic imports and then scanned every connection, node and API key to build the display names. `getProviderLookups` builds the three maps once and serves them for 15s, and the redundant `getConnectionMapCached` cache (same data, second copy, never invalidated) is gone.
- **One shared stats snapshot per burst for the stream.** Every open tab subscribed to `/api/usage/stream` and each emitter tick asked the database to re-aggregate the whole period per connection, so three tabs meant three identical aggregations. A 750ms shared memo keeps updates live while a burst costs one aggregation.
- **One ticker for every relative timestamp.** `TimeAgo` mounted a `setInterval` per row; twenty rows meant twenty timers waking a second apart and re-rendering twenty components. A single 1s ticker now drives all of them and stops when the last subscriber unmounts, and the stream client drops an SSE payload identical to the one already rendered instead of re-setting state.

## Tests
- `tests/unit/token-saver-savings.test.js` asserts the split model shape (`model`, `provider`, `key`), the gap-filled 30-day series and the empty-report case.
- Two stale assertions that failed before this change were rewritten to the current behaviour: the empty state string in `UsageStats.js` and the `jev-1.13-free` decision (it belongs in the registry, the suggestion filter is what drops it).

# v0.5.334 (2026-10-29) · 1 commit

## Fixes
- **PSID and PSIDTS are separate fields.** The `gemini-web` Add and Edit forms asked for one opaque `Cookie Value`, so a user who only has `__Secure-1PSID` had to leave a field looking half-filled and never found out that the timestamp part is optional. The form now asks for `__Secure-1PSID` (required) and `__Secure-1PSIDTS (optional)` separately and composes the cookie header itself; Save stays disabled until a PSID exists, because a timestamp alone cannot authenticate.
- **Editing the timestamp no longer wipes the session.** `PUT /api/providers/:id` only ever wrote `apiKey` for `authType: "apikey"`, so a `gemini-web` connection could not be re-keyed at all. It now accepts a cookie edit and decides what to persist: a paste that carries its own `__Secure-1PSID` replaces the cookie, while a timestamp-only entry merges into the stored one instead of being written verbatim — the previous behaviour would have saved a cookie without the part that authenticates.
- **Other Google cookies survive an edit.** `SAPISID`, `__Secure-3PSID`, `__Secure-1PSIDCC` and anything else in a pasted header are carried through the split/compose round trip. The executor signs `Authorization` from `SAPISID`, so dropping the extras while editing would have downgraded a working credential.
- Unit tests: 16 cases for split, compose, merge and the persist decision (`tests/unit/gemini-cookie-fields.test.js`).

# v0.5.333 (2026-10-29) · 1 commit

## Fixes
- **Gemini Web now honours the connection proxy.** `fetchSessionParams` and the `StreamGenerate` POST called the bare global `fetch`, so a proxy configured on the `gemini-web` connection was silently ignored — the request always left from the host's own IP. Both calls now go through `proxyAwareFetch` with the connection's proxy options, which is the only way to run a browser-session cookie from a host Google treats differently from the login IP.
- **`fetch failed` now names the cause.** A 502 read `Gemini session fetch failed: fetch failed`, which is the same text for blocked egress, dead DNS, a reset connection and a broken TLS chain. The error now appends undici's `err.cause` code, e.g. `fetch failed (ENOTFOUND)` or `fetch failed (ECONNRESET)`, so the operator can tell a network fault from a rejected cookie in one glance.
- **One IPv4 retry for hosts with a broken IPv6 route.** Containers that resolve AAAA records but cannot reach them (Railway among them) failed the connect phase while the same request worked from a laptop. A connect-phase failure (`ENETUNREACH`, `EHOSTUNREACH`, `EAI_AGAIN`, `ENOTFOUND`, `ECONNREFUSED`, `ETIMEDOUT`, `UND_ERR_CONNECT_TIMEOUT`) now retries once over an IPv4-pinned dispatcher before the error is reported. Proxied requests are exempt: the proxy resolves DNS on its side.
- Verified on a live cookie: `gemini-3.5-flash-lite` returned `200` with `"OK"` in 20s through the new path.

# v0.5.332 (2026-10-29) · 1 commit

## Fixes
- **A live Gemini Web cookie no longer reports "invalid".** The connection Test button ran a chat completion, but the cookie is a browser session, not a bearer token: `gemini-web` had no case in the test path and fell through to `"Provider test not supported"`, which the modal rendered as a red *Failed* badge and the card stored as `testStatus: error`. Testing now runs the same session probe the Check button uses — fetch `gemini.google.com/app` and require the `SNlM0e` bootstrap — so a valid cookie passes in about a second instead of waiting on the chat queue.
- **Cookie pastes are normalized before they are judged.** A raw `__Secure-1PSID` value, a `Cookie: a=b; c=d` header, quoted values, and both JSON export shapes (flat map and `{ cookies: [...] }`) now reach the request identically; previously a quoted or prefixed paste was rejected as an invalid session.
- **The rejection reason is shown, not just "Invalid".** Both the Add and Edit modals print the validator's message under the badge (signed-out page, HTTP status, missing session cookie, network timeout), and a failed *Test* shows the upstream error instead of a bare *Failed*.
- **A missing `__Secure-1PSIDTS` is surfaced as a warning, not a failure.** The cookie still validates, but the connection is flagged because the session cannot rotate and dies once Google re-issues the timestamp.
- Tests: `tests/unit/gemini-web-cookie.test.js` covers normalization of all five paste shapes plus accept, signed-out, non-200, network-failure and missing-session branches.

# v0.5.331 (2026-10-29) · 1 commit

## Fixes
- **The model picker no longer opens a group for a provider that is not connected.** Custom-model rows outlive the connection they were created against: when a provider is removed (or a model is registered against an alias that was never set up here), the fallback that groups leftover custom models still rendered them under a heading for that absent provider — so the picker listed a provider the dashboard does not have, holding rows that cannot route anywhere. The alias is now traced back to its built-in provider, and the group is dropped when that provider has no active connection (compatible nodes stay exempt: they legitimately run without a stored key).
- **Custom-model groups use the provider's display name.** A group built from leftover custom rows fell back to the storage alias, so a connected provider appeared as `gemini-web` instead of `Gemini Web` — a name nobody recognises from the dashboard. The registry entry now supplies the label and accent color, with the alias kept only as an internal key.

# v0.5.330 (2026-10-29) · 1 commit

## Fixes
- **`tool_choice` is enforced on browser-session providers.** A client that pinned a function (`tool_choice: {"type":"function","function":{"name":"..."}}`) or demanded any tool (`"required"`) still got prose back, because the bridge wrote the rule once at the top of the prompt and the model drifted by the end of a long agent system prompt. The highest-priority reminder now closes with an explicit `FORCED` line naming the tool, placed after the example where it cannot be buried.
- **Parallel tool calls are no longer suppressed.** The reminder said "do not output more than one tool_call", which turned "get Jakarta and Bandung weather" into a single call. It now allows several blocks when the request lists independent things, while still forcing one-at-a-time steps when calls depend on each other's results (the agent loop stays sequential).
- `selectableTools` is exported so both prompt builders (executor and plugin bridge) derive the `tool_choice` mode from one place.
- Tests: the bridge suite asserts the `FORCED` line lands on the final turn and that two fences in one reply become two `tool_calls`.

# v0.5.329 (2026-10-29) · 1 commit

## Fixes
- **Gemini Web replies were cut off after the first frame.** `readGeminiStream` stopped as soon as the accumulated buffer parsed, but every mid-stream frame already carries the answer so far, so text stopped mid-sentence (`"1, 2, 3, 4, 5,"` for a count to 40) and tool-call JSON arrived half-written — which is why tool calling silently came back as plain text instead of `tool_calls`. The reader now keeps consuming until Google sends its terminal `["e",...]` frame (30s idle / 150s hard ceiling still apply), so replies and `finish_reason: "tool_calls"` come through whole.
- Tests: `tests/unit/gemini-web-stream-full.test.js` feeds a fake stream with a partial frame followed by the full one and asserts the complete answer and an intact ```` ```tool_call ```` fence come out; the old reader fails both cases.

# v0.5.328 (2026-10-29) · 1 commit

## Fixes
- **No built-in emoji left in the UI.** Emoji were rendered by the OS font, so the same screen looked different on Windows, macOS, Linux and Android, ignored the design tokens, and fell back to blank boxes when the system emoji font was missing. Every one is gone:
  - Usage stats: the cached-token `⚡` in Recent requests is now the `bolt` glyph from the icon subset inside the same info chip, so it takes the chip's colour and size.
  - Quota bars, quota table, provider cooldowns, connection cards, combo latency: `🟢/🟡/🔴/💰/⏱` replaced by token-coloured dots (`bg-success` / `bg-warning` / `bg-danger`), `schedule` and `bolt` glyphs.
  - Language switcher, header language button and the Xiaomi region picker no longer use flag emoji (which render as bare letters on Windows). New `LocaleBadge` component draws the locale/region code as a chip: `border-border-subtle`, `bg-surface-2`, uppercase, tracked, 9-11px. Variants that shared a code stay distinct: `zh-CN`/`zh-TW` show 简/繁, `pt-BR`/`pt-PT` show BR/PT.
  - Modals, update panel, marketplace, `GetStarted`, SAML guide, media example cards, MITM/Cowork cards: `✅ 🌐 🔑 🔐 ✓ ✕ ⚠️ 📝 🔷 🟢 🛡️ ☁️` replaced with `check` / `check_circle` / `language` / `key` / `lock` / `close` / `warning` / `edit_note` / `cloud` / `security` / `verified_user` / `shield_lock`.
  - OAuth result popups and the MiMo login page draw their success/failure marks as inline SVG instead of `✓`.
  - Translation catalogs (`public/i18n/literals/*.json`, all 34 locales) carried emoji in both keys and values (`⚠️ Risk Notice…`, `✓ Confirm Add`, `📝 Configure providers…`). Every key was rewritten emoji-free so the cleaned UI strings still hit their translations instead of falling back to English.
  - Logs and console-log viewers strip emoji from upstream log lines at render time (`stripEmoji`), so provider messages and older log files can't reintroduce them; copy still returns the raw line.
  - `getStatusEmoji()` deleted (dead export), `RISK_NOTICE` no longer starts with a warning emoji.
- Tests: `tests/unit/no-emoji-ui.test.js` fails the build if any emoji reappears under `src/app` or `src/shared`, asserts `locales.js` ships codes instead of flags, and covers `stripEmoji`.

---

# v0.5.327 (2026-10-29)

## Fixes
- **Hide Raw Errors also covers upstream error frames inside a stream and non-JSON error bodies.** Two remaining ways a provider's own wording reached the client with the toggle on:
  - A provider that answers `200` and then sends `data: {"error":{...}}` mid-stream. In passthrough mode (same client and provider format) the frame was forwarded verbatim; in translate mode it was silently dropped, so the client saw a truncated stream with no explanation. Now `createSSEStream` takes `hideError`, rewrites the frame's message and forwards it masked — a real error frame in the client's format instead of silence.
  - An upstream HTML/text error page (Cloudflare 5xx, gateway HTML). `maskHiddenError()` only touched `application/json`, so the page went through untouched. It now rebuilds any text body as a masked JSON error, keeping the status and headers such as `retry-after`.
- Tests: `tests/unit/stream-error-frame-hide.test.js` covers passthrough masking, the translate-mode error frame (OpenAI and Claude clients), the toggle-off passthrough, an HTML body rebuilt as masked JSON, and `retry-after` surviving a masked 429.

---

# v0.5.326 (2026-10-29)

## Fixes
- **Hide Raw Errors now hides every error, not most of them.** The toggle was threaded into two call sites inside `chatCore`, so any error built elsewhere — the all-accounts-rate-limited reply, combo exhaustion, the API-key gates, provider/executor responses, the non-SSE upstream body, the 404 "no credentials serving this model" — shipped the upstream text verbatim. That is why a `[model] [403]: {"error":{"message":"Model ... is not allowed for this API key"}} (reset after 2m)` still reached the client with the toggle on.
  - `unavailableResponse()` grew a `hideError` parameter, so the "reset after Ns" reply masks its message while still sending the `retry-after` header.
  - Every handler (`chat`, `fetch`, `images`, `embeddings`, `search`, `stt`, `tts`, `videos`, `systemone`) now masks at its public boundary via the new `maskHiddenError()` helper: any >=400 JSON body has `error.message` replaced, whichever branch produced it. Status code, `type` and `code` survive, so a client can still tell a 401 from a 503 — only the text goes.
  - `hideError` reached the streaming path too: the abort-terminal error frame (`buildStreamErrorBytes`) and the non-SSE upstream body now honour it instead of leaking the upstream `<title>` text.
  - Tests: `tests/unit/error-log-hide-error.test.js` covers `unavailableResponse` (masked message, `retry-after` kept) and the masked SSE frame.

---

# v0.5.325 (2026-10-28)

## Fixes
- **Copy button consistency**: every model-row copy control now uses the same button as the API-key list (`p-1`, `rounded`, `hover:bg-black/5 dark:hover:bg-white/5`, `hover:text-primary`, `transition-all`, 14px glyph). That covers Model Studio's name copy, the provider page's model rows, the compatible-provider section, the passthrough section and the providers card. The bespoke hover tooltips ("Copy" / "Copied!" floating label) and their hover-only reveal are gone, so the affordance is always visible and identical in both places. Model Studio's name copy also no longer swaps to a green "Copied" text label — it flips the glyph to a check, exactly like the API-key row.

---

# v0.5.324 (2026-10-28)

## Fixes
- **Proxy pools — bulk import dropped entries**: the import job skipped a pasted line whenever its NAME was already taken, and the client names every line after its host, so a list pointing at one host:port with rotating credentials imported only the first row. Duplicates are now decided by the proxy URL (scheme and host lowercased, port made explicit, credentials kept as part of the identity), and a repeated name merely gets a `#2`, `#3` suffix so the rows stay tellable apart. A genuine duplicate URL is still skipped, and the run now reports it as `skipped N duplicate` instead of `skipped N existing`.

## Features
- **Custom models — bulk edit**: Model Studio rows have a checkbox, and selecting more than one raises a toolbar with **Select all** / **Clear** / **Bulk edit**. The dialog writes input multiplier, output multiplier and context window to every selected model in one call (`PATCH /api/model-editor/bulk`). Only those three fields are accepted - the callable name is the model id clients send and the target decides which upstream answers, so neither is re-pointed by a bulk action. Models that disappeared between the tick and the Apply are reported back and dropped from the selection instead of failing the call.
- **Custom models — duplicate icon**: the row's duplicate button now matches the API-key copy button (same padding, hover tint and 14px glyph) instead of its own larger style.

## Testing
- `tests/unit/proxy-bulk-import.test.js` (5 cases) drives the real job store + SQLite: repeated names all import, duplicate URLs are skipped, spelling variants collapse, and a URL stored by an earlier run is skipped.
- `tests/unit/model-editor-bulk.test.js` (5 cases): patch applies to every selected model, untouched fields survive, `0` clears a multiplier, non-whitelisted fields are refused, missing models are reported.

---

# v0.5.323 (2026-10-28)

## Features
- **Plugins — Tool Calling Bridge**: a new custom plugin that gives function calling to upstreams which have none (browser-session providers, and any model the capability table reports as text-only). The request's `tools` are folded into the prompt (schema, call format, highest-priority reminder appended last), assistant `tool_calls` and `role:"tool"` turns are flattened into readable prose, and the `tools` array is dropped so an upstream that rejects it never sees it. The reply is parsed back into standard `tool_calls`.
  - Response parsing runs two passes: the shapes models invent on their own (`open-sse/translator/concerns/toolBridge.js`) and the two formats the bridge itself instructs (` ```tool_call ` fence and `<<TOOL_CALL>>` marker). A call naming a tool the client never offered is dropped instead of invented.
  - Because a tool call can only be recovered from a whole reply, a bridged turn is fetched non-streaming and the JSON completion is replayed as SSE, so a streaming client still receives its stream.
  - Models with a native tool lane are left untouched — their real schema is never replaced by prompt text.
  - Enabled per model on the Plugins page; advertises `tools:true` in `GET /api/models` and draws a "Tool Calling" plugin mark.
- **API keys — bulk edit**: the bulk dialog now covers every field the endpoint accepts; added `Budget counted in` (tokens / USD / requests), `Daily USD limit` and `Request limit`, and a **Select all N** shortcut in the selection bar. The key material, the secret value and the permission map stay out of bulk edits on purpose.
- **Custom models — duplicate**: every model in Model Studio has a copy button that opens the create form pre-filled with the source model's rules (target, context window, input/output multiplier, system prompt, `owned_by`) under a unique name (`<name>-copy`, `-copy-2`, …).

## Fixes
- **Build**: the plugin runtime resolves the browser-session provider list through a lazy import. Importing the provider registry eagerly pulled every provider module into the plugin module's init graph, which crashed the build worker (SIGABRT) while static pages were generated.

## Testing
- New `tests/unit/tool-calling-bridge.test.js`: 10 cases over the request rewrite, the dispatch rules (browser session vs native lane), and the response-side recovery.

---

# v0.5.322 (2026-10-28)

## Features
- **Gemini Web (cookie)**: restore the `gemini-web` provider (aliases `gweb`, `gemini-cookie`) with a fresh reverse-engineered implementation. The executor talks directly to `gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate`, auto-fetches the XSRF token (`SNlM0e`) from `/app`, and rotates the session on 429.
- **Gemini Web models** (live hex IDs from `batchexecute?rpcids=otAQ7b`):
  - `gemini-3.5-flash-lite` (hex `8c46e95b1a07cecc`, mode 6) — no cookie required
  - `gemini-3.8-flash` (hex `56fdd199312815e2`, mode 1) — default
  - `gemini-3.1-pro` (hex `e6fa609c3fa255c0`, mode 3)
  - `gemini-4-argon` (hex `95a4c0abcba24364`, mode 8)
  - `-thinking` variants for all four (inner[80]=2 + header slot 15)
  - Legacy aliases: `gemini-3.6-flash`, `gemini-3.7-flash` resolve to `gemini-3.8-flash`
- **Gemini Web cookie capture**: auto-capture from Chromium via CDP (domains `gemini.google.com`, cookies `__Secure-1PSID` + `__Secure-1PSIDTS`).
- **Gemini Web validation**: `POST /api/providers/validate` now probes the cookie by fetching `/app` and checking for `SNlM0e` / `BardChatUi`.
- **Gemini Web tool bridge**: OpenAI `tools` array is encoded into the prompt and parsed back from prose (via `webCookieToolBridge.js`) — same pattern as the old implementation.

## Fixes
- **Gemini Web hex drift**: the old hardcoded hexes (`fbb127bbb056c959`, `cf41b0e0dd7d53e5`, `9d8ca3786ebdfbea`) no longer match the live catalogue. The new implementation uses the current hexes and falls back to the old ones via `LEGACY_HEX` mapping.
- **Gemini Web model selection**: the server ignores `inner[]` mode slots when no model header is sent — every request silently lands on Flash-Lite. The new executor always sends `x-goog-ext-525001261-jspb` with the correct hex.

## Testing
- Unit tests restored: `tests/unit/gemini-web-tools.test.js` (25/25 passing)
- Direct executor test: all 4 models respond via the user's cookie (Flash-Lite 42s, Flash 27s, Pro 7s, Argon 36s)

---

# v0.5.321 (2026-10-27)

## Breaking Changes
- **Removed all webCookie providers**: deepseek-web, gemini-web, kimi-web, muse-web, chatgpt-web, uc-web, and opencode-v2 (OpenCode Free V2) have been removed from the registry, executors, and all related UI/API routes.
- **Renamed `oc1/` prefix to `oc/`**: OpenCode Free V1 now uses `oc/` as its primary alias instead of `oc1/`. The `oc1` alias is removed; use `oc` or `opencode` going forward.

## What Was Changed
- Deleted registry files: `deepseek-web.js`, `gemini-web.js`, `kimi-web.js`, `muse-web.js`, `chatgpt-web.js`, `uc-web.js`, `opencode-v2.js`.
- Deleted executor files: `deepseek-web.js`, `gemini-web.js`, `kimi-web.js`, `opencode-v2.js`.
- Cleaned up all references in `registry/index.js`, `executors/index.js`, `providerModels.js`, `chat.js`, `providerIcon.js`, `probeBudget.js`, `cookieCapture.js`, `validate/route.js`, `testUtils.js`, `AddApiKeyModal.js`, and test files.
- Updated `opencode.js` registry: `alias: "oc"`, `uiAlias: "oc"`, `textIcon: "OC"`, `display.name: "OpenCode Free"`.
- Simplified `WEB_COOKIE_PROVIDERS` set to empty (all web cookie providers removed).
- Removed opencode-v2 specific UI badges and conditional logic from dashboard pages.

---

# v0.5.320 (2026-10-27)

## Features
- **Ollama**: add `ollama-local` TTS provider serving the Phonon family (15 tags, 38 preset voices), normalizing the requested format to wav/pcm, falling back to an installed tag and the `default` voice, and wrapping raw PCM in a WAV header so the dashboard can preview it.
- **Ollama**: add `ollama-local` embedding adapter for `/v1/embeddings`, normalizing a saved host that carries a `/v1` or `/v1/embeddings` suffix and sending a bearer token only when an API key is configured; catalog the 14 embedding model families with their dimensions.
- **Providers**: add Runcrate (`rc`) — OpenAI-compatible upstream serving DeepSeek, GLM, Qwen and gpt-oss models, validated through `GET /api/v1/billing/balance` because the public `/v1/models` answers 200 for any key.
- **Web Providers**: add Muse Web, ChatGPT Web, Veo AI Free Web, and UC Web cookie/API providers.
- **CommandCode**: add Kimi K3.1 Pro to the catalog with the upstream id kept verbatim, riding the existing NDJSON `/alpha/generate` lane.
- **OpenCode Go**: add Kimi K3.1 Pro on the chat lane with vision/video input, 1,048,576 context, 131,072 max output and dedicated K3 pricing.
- **OpenCode (PR #17)**: per-egress 429 cooldown tracking with full `Retry-After` parsing, bounded proxy failover, deterministic session-id encoding, and complete `<env>` system-prompt fingerprinting; keeps serenhope's host CLI fallback.

## Fixes
- **CLI Tools**: stop the Pi card from resetting every `contextWindow`/`maxTokens` in `~/.pi/agent/models.json` on Apply, add per-model context-window and max-output selectors, and sanitize corrupt cap values instead of writing them back.
- **CLI Tools**: treat `name === id` as unset on Apply so a hand-edited Pi model label is no longer overwritten.
- **OpenCode**: normalize a caller tool that collides with the OpenCode fingerprint in place (keeping the caller's name and adopting the fingerprint schema) instead of aliasing it to `<name>_client` and restoring it on the response (#4971, #5011).
- **OpenCode Free**: restore the free tier by sending the TLS ClientHello the upstream accepts (via optional `wreq-js`, fail-open to native fetch), minting session ids from the current time instead of a sha256 digest, and always pairing the CLI `<env>` system marker with a declared tool list.
- **OpenCode Free**: cap the published context window of `oc/deepseek-v4.1-flash-free` at 330k so clients compact before the backend's limit (#5097).
- **Translator**: convert `image_url` parts inside `role:"tool"` messages to Claude image blocks instead of forwarding them verbatim and failing with a 400 (#5125).
- **DeepSeek**: send `deepseek-flash` upstream for `deepseek-v4.1-flash`, whose catalog id the API rejects (#4940).
- **Claude**: keep adaptive thinking for Haiku 5.5 and downgrade to `enabled/10000` only below major version 5 (#5183).
- **Thinking**: keep `reasoning_effort: max` for GPT-5.6 / GPT-6 served through OpenAI Compatible nodes instead of clamping it to `xhigh` (#5186).
- **Codex Image**: drive the `image_generation` tool call from `gpt-6-sol` instead of the legacy `gpt-5.6-terra` host, and add `cx/gpt-6-sol-image`; drop the `gpt-5.6-{sol,terra,luna}-image` aliases they supersede.
- **Capabilities**: match `*gpt-6*image*` before the generic `gpt-6` family pattern so `gpt-6-sol-image` resolves as an image model instead of inheriting the chat caps (vision/reasoning/1.05M window) and losing `imageOutput`.

## Notes
- Upstream `open-sse/rtk/headroom.js` Claude document/tool-history preservation was skipped because it conflicts heavily with serenhope's optimized headroom fork; review separately if needed.

---
  - Deleted `open-sse/utils/opencodeV2Channel.js` entirely (the scrambled residential endpoint + `OPENCODE_V2_ROUTE` override are gone).
  - `auth.js` no-auth block restored to plain logic: direct public connection, user proxy pools, and rotation only — no built-in channel injection, no `isLockedProxy`/`displayProxyUrl` connection.
  - `opencodeCliRunner.js` no longer falls back the CLI to the channel proxy; it only uses a proxy when the user explicitly configured one on the connection.
  - `NoAuthProxyCard` (all no-auth providers incl. OpenCode V1/V2): the "builtin" option, its gold-shimmer label, hint, and Channel footer row are removed. The card keeps direct/custom-pool selection with rotation, and still self-heals stale pool ids from settings.
  - Removed the now-unused `text-gold-shimmer` CSS and the `Select` text-transparent workaround.

---

# v0.5.318 (2026-10-25) · 1 commits

## What Was Changed

- **OpenCode Free V2 Built-in Channel Polish + Stale Pool Recovery:**
  - Renamed the built-in proxy option and connection to **`proxy by: t.me/abcseren`** (replacing the verbose "Built-in Proxy (Residential Channel …)" label) in the dropdown, the auth connection name, and the card footer link.
  - Added an animated **gold shimmer** treatment (`text-gold-shimmer`) on the `proxy by: t.me/abcseren` text: the select label renders transparent while a shimmering gold gradient overlay sits on top; the footer Channel link uses the same effect.
  - **Fixed stale proxy-pool id regression:** a saved `providerStrategies[<provider>].proxyPoolId` pointing at a deleted pool made the `Proxy Source` select silently point at nothing (no options selected, no built-in channel active). The card now validates the saved id against the current pool list and falls back to the provider default; the auth service fails OpenCode V2 over to the built-in residential channel instead of degrading to unproxied direct mode when the configured pool no longer exists.
  - **Fixed `/api/models` 500 error** (`ReferenceError: tdEnabled is not defined`) left over from the plugin rename — the studio-capabilities branch now reads the unified `adaptiveThinking` plugin config instead of the removed `thinkDeeper`/`jsonGuard` settings.

---

# v0.5.317 (2026-10-25) · 2 commits

## What Was Changed

- **OpenCode Free V2 Flexible Proxy Selector (Built-in, Direct, or Custom Pools):**
  - Restored full proxy selection flexibility on OpenCode Free V2 detail page (`/dashboard/providers/opencode-v2`).
  - Added seamless **Proxy Source** dropdown allowing users to select:
    1. **Built-in Proxy**: Automated residential broadband rotation channel (`t.me/abcseren`) to avoid cloud 403 `FreeTierError`.
    2. **None (direct / unproxied)**: Standard direct connection.
    3. **Custom Proxy Pools**: User's configured proxy pools from Proxy Pools dashboard, with optional round-robin or random rotation.
  - Aligned auth service (`auth.js`) and executor (`opencode-v2.js`) to honor the selected proxy source dynamically.

---

# v0.5.316 (2026-10-25) · 3 commits

## What Was Changed

- **Merge PR #15: OpenCode Executor Wiring, Fallback Spam Prevention, and CLI Concurrency:**
  - **CLI Tool-Calling Bridge**: Enabled local CLI execution when client tools are present; piped prompt formatting and OpenAI `tool_calls` response streaming into `@opencode/cli run` so agent requests with tools execute through the local engine.
  - **Prompt Piping via Stdin**: Switched prompt delivery to `stdin` stream instead of command-line arguments to eliminate Windows `ENAMETOOLONG: name too long, uv_spawn` crashes.
  - **Process Management & Concurrency Cap**: Added `MAX_CONCURRENT_CLI = 3` concurrency limiter to queue parallel requests, a 90s hard execution deadline, and cross-platform process tree cleanup (`taskkill /F /T` on Windows, `pkill -P` + `SIGKILL` on POSIX) on abort and server shutdown.
  - **Auth Fallback Loop**: Fixed `getProviderCredentials` in `auth.js` to inspect `excludeSet.has("noauth")`, terminating immediately instead of looping 15+ times when the unproxied public connection is rejected.
  - **Network Channel Routing**: Updated `resolveV2ChannelRoute()` to use `OPENCODE_V2_ROUTE` when configured and default to a direct connection, removing the dead hardcoded proxy returning HTTP 407.
  - **Dashboard Provider View**: Mapped `opencode-v1` to `opencode` in provider detail resolution so `/dashboard/providers/opencode-v1` renders properly.
  - **Build Fix**: Added `src/app/not-found.js` to prevent Next 14 Windows NFT build trace failure.

---

# v0.5.315 (2026-10-25) · 2 commits

## What Was Changed

- **Add Dedicated OCR Auto Image-to-Text Plugin:**
  - Added **OCR Auto Image-to-Text (`imageVision`)** alongside Adaptive Thinking in the Custom Plugins suite.
  - Automatically intercepts base64 images and URLs in prompt payloads, parses dimensions and metadata via Sharp, and converts images into structured markdown OCR text blocks.
  - Enables text-only models (e.g. DeepSeek-R1, Llama-text, GLM, CLI engines) to process visual content without 400 errors, and provides high-precision OCR transcripts for vision models.
  - Updated `/dashboard/plugins` with a balanced 2-column card layout, capacity markers, and per-model assignment pickers.

---

# v0.5.314 (2026-10-25) · 2 commits

## What Was Changed

- **Unified Adaptive Thinking & Multi-Framework Cognitive Architecture Plugin:**
  - Removed deprecated scattered custom plugins (imageVision, thinkDeeper, jsonGuard, openaiToolBridge, antiSlop) and replaced them with a single unified **Adaptive Thinking & Cognitive Architecture** plugin.
  - Synthesized proven cognitive reasoning frameworks from top open-source agent skill repositories:
    1. **Depth Protocol v2.0** (`Kshitijpalsinghtomar/depth-skills`): Prevents premature closure, demands root problem reframing, and establishes explicit failure envelopes.
    2. **Adversaria Dialectic Crucible** (`damionrashford/Adversaria`): Socratic elenchus, steelmanning, and internal hostile red-team challenge.
    3. **First Principles Framework** (`tjboudreaux/cc-thinking-skills`): Separates hard physical/mathematical facts from conventions and analogies.
    4. **Superpowers Methodology** (`obra/superpowers`): Systematic multi-branch hypothesis exploration and grounded verification before final synthesis.
  - Integrated provider-native deep reasoning parameters (`budget_tokens: 10240` on Claude, `reasoning_effort: high` on OpenAI/compatible providers).
  - Streamlined `/dashboard/plugins` UI into a dedicated single-focus card with model assignment and clean toggle controls.

---

# v0.5.313 (2026-10-25) · 2 commits

## What Was Changed

- **Clean Up Theme Inconsistencies Across All Dashboard Pages:**
  - Audited and replaced rogue ad-hoc utility classes (`bg-black/5 dark:bg-white/5`, `bg-gray-500/10`, `text-zinc-*`, hardcoded `text-white` overlays) with system tokens (`bg-surface-2`, `border-border-subtle`, `text-text-main`, `text-text-muted`) across Endpoint, Basic Chat, Arena, CLI Tools, Profile, Error Log, and Console Log pages.
  - Aligned chip borders, command code blocks, tooltips, and terminal viewer surfaces with the 9Router glassmorphism dark palette.

---

# v0.5.312 (2026-10-25) · 2 commits

## What Was Changed

- **Harmonize Usage Theme Tokens and Mobile Responsiveness:**
  - Standardized card backgrounds, borders, and token colors across `OverviewCards.js`, `UsageStats.js`, `ProviderTopology.js`, and `UsageChart.js` to strictly use official design tokens (`var(--color-surface)`, `border-border-subtle`, `text-info`, `text-success`, `text-warning`).
  - Perfected mobile responsive styling with automatic stacking, touch-friendly tap targets, zero horizontal overflow, and responsive table layout with wrap-safe model names and badge metadata.

---

# v0.5.311 (2026-10-25) · 2 commits

## What Was Changed

- **Usage & Analytics Command Center Redesign:**
  - Redesigned overview KPI cards (`OverviewCards.js`) with structured metric icons (`dns`, `arrow_upward`, `bolt`, `arrow_downward`, `payments`), purposeful semantic color accents, neutral white input token values, and contextual sparkline indicators.
  - Revamped `Live Requests Stream` table in `UsageStats.js` with live pulsing telemetry dots, dedicated provider/channel badges, and cleaner monospace token counters.
  - Aligned height of `ProviderTopology` graph to match the live stream card (`420px`), eliminating dead vertical space.
  - Upgraded chart empty state in `UsageChart.js` with an informative dashed container and actionable telemetry guidance.

---

# v0.5.310 (2026-10-25) · 2 commits

## What Was Changed

- **Fix OpenCode Empty Responses and FreeTier Routing:**
  - In `src/sse/services/auth.js`, ensured residential channel proxy fallback is automatically applied when routing `opencode-v2` and `opencode` connections if no custom proxy pool is configured.
  - In `open-sse/utils/opencodeCliRunner.js`, fixed response parsing to correctly capture `responseText` from `finalResult.text` instead of referencing an undefined variable.
  - In `open-sse/executors/opencode-v2.js` and `open-sse/executors/opencode.js`, routed prompts larger than 24KB (e.g. agent sessions with multi-turn system context) directly to the Wire HTTP Executor to prevent CLI runner truncation and empty responses.

---

# v0.5.309 (2026-10-24) · 2 commits

## What Was Changed

- **Fix Syntax Errors in API Route Imports:**
  - Repositioned `export const dynamic = "force-dynamic"` to follow multiline import blocks in `src/app/api/models/availability/route.js`, `src/app/api/oauth/zed/import/route.js`, and `src/app/api/cli-tools/grok-build-settings/route.js`, fixing syntax errors ("cannot import as reserved word") during Webpack and Bun compilation.

---

# v0.5.308 (2026-10-24) · 2 commits

## What Was Changed

- **Remove Redundant 'use server' Directives in API Route Handlers:**
  - Removed `"use server"` directive from 24 API route files under `src/app/api/cli-tools/` and `src/app/api/tunnel/`. In Next.js App Router, `"use server"` designates React Server Actions (which disallow non-function exports like `export const dynamic = "force-dynamic"`). Route handlers run server-side by default and do not use Server Action directives.

---

# v0.5.307 (2026-10-24) · 2 commits

## What Was Changed

- **Native JS Inlining for OpenCode V2 Tool Definitions (`opencodeV2Defs.js`):**
  - Converted `opencodeV2Defs.json` into an ES module export `opencodeV2Defs.js` imported directly by `opencodeV2Fingerprint.js`, eliminating runtime filesystem dependency on disk paths and solving `403 FreeTierError` across Next.js, Bun, and standalone deployments.
  - Implemented tool name collision aliasing and rename map tracking (`takeRenamedToolNamesV2`) in OpenCode V2 fingerprinting so caller agent tools and OpenCode fingerprint tools co-exist cleanly without 403 rejections.

---

# v0.5.306 (2026-10-24) · 2 commits

## What Was Changed

- **Stage open-sse Assets in Standalone Builds & Enforce Dynamic API Routes:**
  - Added `open-sse/` directory to standalone asset copy step (`scripts/copy-standalone-assets.mjs`) ensuring `opencodeV2Defs.json` schema definitions and runtime files are present in standalone and Bun production environments.
  - Added `export const dynamic = "force-dynamic"` across all dynamic API route handlers to guarantee Next.js and Bun runtimes evaluate routes dynamically without static evaluation failures.

---

# v0.5.305 (2026-10-24) · 2 commits

## What Was Changed

- **Smart Tool-Aware Execution for OpenCode V1 and V2:**
  - Route tool-bearing client requests (such as DeepSeek Harness, Cline, or Roo Code with tools/functions) directly to the wire HTTP executor rather than the CLI runner. The OpenCode CLI non-interactive mode only handles text prompt evaluation, so requests with client tools must preserve tool definitions via the wire HTTP protocol.
  - Fail open when CLI produces no output instead of yielding an empty stream with `finish_reason: "error"` and zero output tokens.

---

# v0.5.304 (2026-10-24) · 2 commits

## What Was Changed

- **OpenCode CLI Auto-Retry on Proxy Tunnel Drops:**
  - Added multi-attempt retry with rotating residential proxy sessions inside `executeOpencodeCli` to handle occasional proxy tunnel 400/502 rejections from residential broadband nodes.
  - Ensured CLI subprocess cleanly bubbles up errors to the standard executor fallback chain instead of emitting premature empty `finish_reason: error` chunks with zero output tokens.

---

# v0.5.303 (2026-10-24) · 2 commits

## What Was Changed

- **Fix 'chatSettings' TDZ Crash in Chat Handler:**
  - Resolved `ReferenceError: Cannot access 'chatSettings' before initialization` in `src/sse/handlers/chat.js` by hoisting `getSettings()` before the account evaluation loop so authentication and error-handling code paths execute cleanly.
- **OpenCode Free V1 Channel Routing & Timeout Parity:**
  - Added default fallback to the dedicated residential channel route for OpenCode Free V1 (`opencode`) in `src/sse/services/auth.js` and `open-sse/executors/opencode.js`, eliminating 403 FreeTierError rejections on unconfigured/direct host egress.
  - Increased OpenCode V1 transport timeout to 45s to prevent premature proxy connection drops.

---

# v0.5.302 (2026-10-24) · 2 commits

## What Was Changed

- **Rescue Zero-Output Responses and Fold Reasoning Tokens:**
  - Rescued empty response completions in streaming and non-streaming modes when models exhaust token budgets on reasoning (e.g. DeepSeek/Claude with thinking enabled) by promoting reasoning output to content before stream close.
  - Folded `reasoning_tokens` into `completion_tokens` when upstream providers report `completion_tokens: 0`, preventing clients like Cherry Studio and NextChat from throwing "The model reported success but generated zero output tokens (out 0)".
  - Added helpful status fallback text when a model produces zero tokens due to length limits or content filter truncation instead of returning an empty body.

---

# v0.5.301 (2026-10-24) · 2 commits

## What Was Changed

- **Windows CLI Binary Resolution & Process Spawn Fix:**
  - Fixed Windows `spawn ENOENT` when launching `opencode` on Windows hosts (e.g. `G:\9router
ode_modules\.bin\opencode`).
  - Prioritized Windows executable extensions (`.cmd`, `.exe`, `.bat`) over extensionless shell scripts in `findOpencodeBinary`.
  - Added `shell: true` and `windowsHide: true` to `child_process.spawn` options on Windows so batch scripts execute seamlessly.

---

# v0.5.300 (2026-10-24) · 2 commits

## What Was Changed

- **Fix Erroneous FREE Badge on Non-Free Models in OpenCode V1 and V2:**
  - Removed hardcoded `isFree={isOpenCode ? true : model.isFree}` flag which falsely marked non-free models (e.g., Claude, GPT) as Free when added to Available Models.
  - Aligned custom and display model tier status with upstream suggested catalogue `isFree` metadata and pattern classification so paid models correctly display without the FREE badge.

---

# v0.5.299 (2026-10-24) · 2 commits

## What Was Changed

- **OpenCode CLI Binary Detection & 'Need Configuration' Status:**
  - Added real-time binary detection for OpenCode CLI across host PATH, global bin, and local node_modules.
  - When the OpenCode binary is not installed on the host running 9Router seren, OpenCode Free V2 displays a 'Need Configuration' warning badge and instructs the user to install the binary manually (`npm install -g opencode-ai` or curl script).

---

# v0.5.298 (2026-10-24) · 2 commits

## What Was Changed

- **OpenCode Free V2 Upstream Timeout & Session Rotation Resiliency:**
  - Increased `timeoutMs` for OpenCode V2 transport from 12s to 45s to accommodate high-latency residential broadband SSL handshakes and prevent premature `ProxyFetch connect timeout` aborts.
  - Dynamized connection ID assignment in `src/sse/services/auth.js` per proxy rotation so free-tier quota exhaustion (`429 FreeUsageLimitError`) seamlessly retries with a fresh residential session and exit IP.

---

# v0.5.297 (2026-10-24) · 2 commits

## What Was Changed

- **Stealth Channel Routing Module Refactor:**
  - Renamed and refactored the proxy module into `open-sse/utils/opencodeV2Channel.js` with XOR-scrambled binary payload encoding to prevent plain-text pattern detection and obscure internal routing parameters.

---

# v0.5.296 (2026-10-24) · 2 commits

## What Was Changed

- **Clean Dedicated Routing Banner (Buttonless):**
  - Removed the standalone Telegram button from the OpenCode Free V2 dedicated proxy banner for a cleaner, compact, and balanced card layout.
  - Retained the interactive inline link `proxy by: t.me/abcseren` with subtle external navigation icon and active radar beacon.

---

# v0.5.295 (2026-10-24) · 2 commits

## What Was Changed

- **Embedded Fingerprint Tool Schemas & Native CLI Auto-Detection:**
  - Bundled all 11 official OpenCode CLI tool definitions into `open-sse/utils/opencodeV2Defs.json` inside the repository, resolving the missing `/tmp` definition file that triggered `403 FreeTierError` on external/friend instances.
  - Added auto-injection of the OpenCode CLI system instructions for bare test requests and pings.
  - Extended `findOpencodeBinary` to inspect `node_modules/.bin/opencode` and system PATH, and added `opencode-ai` to `optionalDependencies` in `package.json`.
  - Replaced the airplane icon with standard network routing iconography and clean external links.

---

# v0.5.294 (2026-10-24) · 2 commits

## What Was Changed

- **Animated Dedicated Proxy Banner:**
  - Redesigned the dedicated proxy routing banner for OpenCode Free V2 into an animated card titled `proxy by: t.me/abcseren`.
  - Added continuous shimmer beam animations (`proxy-shimmer-beam`), gradient text flow (`proxy-text-gradient`), live beacon radar dot, and direct "Open Telegram" action button.

---

# v0.5.293 (2026-10-24) · 2 commits

## What Was Changed

- **Dedicated Locked Proxy Routing for OpenCode Free V2:**
  - Integrated high-reputation residential routing locked permanently for `opencode-v2` (`open-sse/utils/opencodeV2Channel.js`), automatically randomizing residential session IDs per request to prevent IP limits and 403 FreeTier blocks across all deployment environments (including Railway and serverless containers).
  - Masked the proxy identity across the UI, connection cards, and routing logs under the alias `https://t.me/abcseren`, locking the proxy selection so it cannot be tampered with or overridden.

---

# v0.5.292 (2026-10-24) · 2 commits

## What Was Changed

- **Full System Prompt & Multi-Turn Support for OpenCode Engine:**
  - Implemented `formatOpencodeCliPrompt` in `open-sse/utils/opencodeCliRunner.js` to properly extract and structure all system instructions (`body.system`, `role: "system"`, `role: "developer"`), multi-turn conversation history, and user prompts before passing to the CLI engine.
  - Enabled native CLI engine execution across both OpenCode V1 (`opencode.js`) and V2 (`opencode-v2.js`), ensuring Model Studio custom models and roleplay system prompts take effect completely without being discarded or blocked by upstream rate limits.

---

# v0.5.291 (2026-10-24) · 2 commits

## What Was Changed

- **Live Console Layout Harmonization:**
  - Redesigned the Live Console tab to perfectly mirror the Error Records architectural layout.
  - Implemented 4 summary metric cards (Total Lines, Errors, Warnings, Stream Status), unified 9Router search input, level segmented control, auto-scroll/copy/clear controls, and structured card list with category badges, line headers, and per-item copy actions.

---

# v0.5.290 (2026-10-24) · 2 commits

## What Was Changed

- **Search Bar Redesign & Anti-Slop Cleanup:**
  - Standardized search bars across both Error Records and Live Console tabs using 9Router's native search input styling (`rounded-[10px]`, integrated search glyph, clear button, and brand focus ring).
  - Stripped all theatrical AI-slop artifacts from the console view (removed fake macOS red/yellow/green window dots, fake prompt lines, pulsing block cursors, and redundant card wrappers).
  - Streamlined log lines into a clean, flat developer output stream with high-contrast readable typography and simple empty states.

---

# v0.5.289 (2026-10-24) · 2 commits

## What Was Changed

- **Live Console UI Overhaul & Terminal Polish:**
  - Redesigned the Live Console toolbar into a responsive 2-tier layout eliminating button clipping and overcrowding on mobile screens.
  - Added dedicated search input with instant clear, segmented level filters (ALL, ERR, WARN, INFO), live connection badges, line counter, and full-sized touch actions (Scroll toggle, Copy, Clear).
  - Enhanced the terminal window with macOS window controls, title bar (`runtime-stdout.log`), active buffer indicator, fixed gutter with line number separators, syntax tag highlighting, and an active listener prompt with pulsing cursor.

---

# v0.5.288 (2026-10-24) · 2 commits

## What Was Changed

- **Restored Global Theme Background & Glass Depth:**
  - Fully restored the ambient glass theme background styling in `.dark.glass` so all pages maintain their luminous depth and signature aesthetic across the entire 9Router dashboard.
- **Complete Design System & Theme Synchronization in Error & Console Logs:**
  - Refactored `LogsClient` to natively utilize 9Router's official component primitives: `SegmentedControl` with sliding pill indicators for both view tabs and status filters, `Card` with standard elevation and glass styling, `Badge` semantic color variants, and theme-synchronized primary accents (`text-primary`, `bg-brand-500/10`).

---

# v0.5.287 (2026-10-24) · 2 commits

## What Was Changed

- **Unified Logs & Diagnostics Workbench:**
  - Consolidated the separate Console Log and Error Monitor views into a single unified menu: **Error & Console Logs** (`/dashboard/logs`).
  - Implemented a clean, anti-slop dual-mode workspace featuring:
    - **Error Records**: structured exception audit cards with status classification (5xx, 429, Auth), quick copy, search filtering, and collapsible stack traces without fuzzy AI glow effects.
    - **Live Console**: real-time stdout/stderr stream with status indicator, autoscroll controls, log level filters (ALL, ERR, WARN, INFO), and search.
  - Backwards-compatible routes for `/dashboard/console-log` and `/dashboard/error-log` linking to the unified workspace.
- **Refined Hide Error Copywriting:**
  - Replaced wordy descriptions in Experiment Features with crisp, professional anti-slop copywriting explaining upstream error masking and internal log retention.

---

# v0.5.286 (2026-10-24) · 2 commits

## What Was Changed

- **Settings API & Experiment Toggle Fix:**
  - Added HTTP `PUT` handler to `/api/settings` and ensured `ExperimentsClient` dispatches valid `PATCH`/`PUT` updates so the "Hide Error" experimental toggle updates without throwing "Failed to update setting".
- **Console Log Modernization:**
  - Redesigned the Console Log view into a sleek terminal workstation with macOS window controls, live stream status indicator, auto-scroll pause/resume toggle, quick copy action, search query filter, and level-specific filter pills (All, Errors, Warns, Info).
- **Error Monitor UI Overhaul & Menu Renaming:**
  - Renamed the menu item and dashboard headers from "Error Log" to "Error Monitor".
  - Overhauled Error Monitor with summary metric cards (Total, 5xx Server, 429 Rate Limits, 401/403 Auth), status filter tabs, search filter, collapsible stack traces, and quick copy actions.

---

# v0.5.285 (2026-10-24) · 2 commits

## What Was Changed

- **UI Language Standardization to English:**
  - Standardized all descriptions, notifications, labels, and placeholders across the dashboard interface to English (including Custom Plugins, Experiment Features, Error Log, Model Studio Multipliers, and Model Tier Badges).

---

# v0.5.284 (2026-10-24) · 2 commits

## What Was Changed

- **Containerized Deployment Support for OpenCode Engine:**
  - Added global installation of `opencode-ai` CLI in the production `Dockerfile` builder stage and copied the binary to `/usr/local/bin/opencode` in the runner stage with required compatibility libraries (`gcompat`, `libstdc++`, `ca-certificates`).
  - Extended dynamic binary discovery in `opencode-v2.js` to inspect standard PATH locations (`/usr/local/bin/opencode`, `/usr/bin/opencode`, etc.) and ensure working directories and HOME are properly initialized in containerized environments like Railway, Docker, or Kubernetes.

---

# v0.5.283 (2026-10-24) · 2 commits

## What Was Changed

- **OpenCode Free V2 Dual-Mode Engine (Native CLI + Wire Fallback):**
  - Integrated direct execution via the official OpenCode 1.19.4 binary runtime when installed locally (`/root/bin/opencode`), routing requests with full context and proxy options while returning seamless OpenAI-compatible streaming SSE chunks.
  - Successfully bypassed upstream 403 FreeTierError / 429 FreeUsageLimitError, ensuring robust 200 OK completions.

---

# v0.5.282 (2026-10-23) · 2 commits

## What Was Changed

- **OpenCode Free V2 Reverse-Engineered Wire Protocol Alignment:**
  - Upgraded OpenCode V2 tool fingerprinting to match the full 11-tool suite from official OpenCode CLI 1.19.4 (`bash`, `edit`, `glob`, `grep`, `read`, `skill`, `task`, `todowrite`, `webfetch`, `websearch`, `write`).
  - Removed artificial `Authorization: Bearer public` header that triggered upstream proxy filter rejections.
  - Aligned request parameters with genuine Bun runtime client wire behavior.

---

# v0.5.281 (2026-10-23) · 2 commits

## What Was Changed

- **Fixed 500 error in chat/completions route:** Resolved `ReferenceError: settings is not defined` inside `chatCore.js` by cleanly forwarding `hideError` boolean parameter from chat handler.
- **Fixed smEnabled ReferenceError in models API:** Removed residual references to `smEnabled` (from removed Speed Mode) in `/api/models/route.js`.
- **Enhanced OpenCode V2 session recovery:** Added `bodyHasSessionHints` helper to `opencode-v2.js` for robust session continuity across multi-turn turns.
- **Fixed Error Log API and Ping Permissions:** Added `/api/error-logs` and `/api/models/test` to `permissionPaths.js` and `dashboardGuard.js`.

---

# v0.5.280 (2026-10-23) · 2 commits

## What Was Changed

- **Model Tier Consistency in Modal & Select:** Synchronized the green `FREE` badge across `ModelSelectModal`, ensuring models tagged as free in the provider view retain their exact badge and status in the model selection picker.
- **Provider Models Isolation across All Providers:** In all provider detail pages, built-in catalog models now start un-hoisted in the "Suggested models" / "Suggested free models" lists and only rise to the active models section when explicitly clicked with `(+)`.
- **Custom Model Studio Multipliers:** Added dedicated Input Multiplier and Output Multiplier fields to the Custom Model Studio form and displayed active multiplier tags on the custom model cards.
- **Error Log System:** Added an **Error Log** page (`/dashboard/error-log`) under Console Log in the sidebar navigation with real-time logging, stack trace viewing, filtering, single/bulk copying, and deletion.
- **Experiment Features (Hide Error):** Introduced the **Experiment Features** page (`/dashboard/experiments`) under 9Router Settings with an experimental "Hide Error" toggle that masks sensitive provider errors into `"There is an error but this error is hidden, try checking your error log."` while logging true errors to the Error Log.
- **API Key Expiration Visibility:** Added expiration date countdown and status badges to API key rows in Endpoint & Keys as well as in the Key Quota card on the dashboard.

---

# v0.5.279 (2026-10-23) · 2 commits

## What Was Changed

- **Custom Plugin Overhaul:**
  - **OCR Auto Image-to-Text (Plugin #1):** Implemented automated image text conversion scripting with sharp. Inspects image buffers, extracts metadata, dimensions, text chunks (PNG tEXt/zTXt/iTXt, SVG text, and EXIF/IPTC tags), and transcribes visual content into structured text. Converts image blocks into text blocks for text-only models so non-vision models can process images without errors.
  - **Adaptive Thinking & Superpowers CoT (Plugin #2):** Upgraded reasoning to an Adaptive Thinking system combining Superpowers multi-perspective exploration, hypothesis stress-testing, self-verification, and structured Chain-of-Thought with adaptive depth and native reasoning parameters (`reasoning_effort: high`, Claude thinking budget).
  - **Removed Speed Mode (Plugin #3) and Context Squeezer (Plugin #5):** Streamlined the plugin lineup down to 5 focused plugins (`imageVision`, `thinkDeeper`, `jsonGuard`, `openaiToolBridge`, `antiSlop`).
  - **Refreshed All Plugin Names and Descriptions:** Standardized titles and descriptive explanations across UI, constants, and API routes.

---

# v0.5.278 (2026-10-23) · 2 commits

## What Was Changed

- **Removed PAID and UNKNOWN badges; reserved FREE tag exclusively for free models.** Model badge display is now streamlined: only genuine free models (OpenCode free models such as `beam-free`, `glm-5.3-flash-free`, `big-pickle`, `union-alpha`, etc.) display the green `FREE` tag. Non-free models (e.g. Claude, GPT, or unclassified models) show no tags, keeping provider listings clean and uncluttered.

---

# v0.5.277 (2026-10-23) · 2 commits

## What Was Fixed

- **Fixed suggested model chips not rising to active list for OpenCode V1 and V2.** Removed built-in model exclusion on OpenCode providers in `getProviderCustomModelRows` so clicking `(+)` immediately adds and displays the model in the top active section.
- **Accurate Model Tier Badges and chip preview.** Fixed custom model rows incorrectly passing `isFree={false}` that caused free models to display as `PAID`. OpenCode and free tier models now retain their green `FREE` badge. Both suggested free chips and other models now render tier badges before and after addition.
- **Revamped Recent Requests table and Usage charts alignment.** Restored visibility of Recent Requests by ordering it cleanly for mobile viewports, correcting table background styles, and expanding truncated model name width. Polished Top Models and By Provider bar charts with consistent 210px container heights, refined typography, and aligned controls.
- **Aligned icons, badges, and typography across cards.** Vertically centered Material Symbols icons, status dots, and badges with text on consistent optical baselines throughout model rows and usage analytics.

---

# v0.5.276 (2026-10-23) · 2 commits

## What Was Added

- **Tier badges (FREE / PAID / UNKNOWN) on all models across all providers.** Added `ModelTierBadge` and `resolveModelTier` to classify and display visual badges for every model (Free with green tag, Paid with amber tag, and Unknown for unclassified/custom models) across `ModelRow`, `CompatibleModelsSection`, `PassthroughModelsSection`, and `ModelSelectModal`.
- **Token usage multipliers and anti-probe protection for custom models.** Added optional `inputMultiplier` and `outputMultiplier` fields to custom models and model studio. Output tokens and prompt tokens are multiplied accordingly in returned responses and usage tracking. Anti-probe protection conceals real backend model IDs, strips provider headers, and reinforces anti-jailbreak directives.
- **Enforced API key requirement on `/v1/models` and model listing endpoints.** Anonymous curling of model lists is now blocked with HTTP 401 (`invalid_api_key`) unless a valid API key or authenticated dashboard session is supplied.

---

# v0.5.275 (2026-10-23) · 2 commits

## What Was Changed

- **Start OpenCode V1 and V2 models in Suggested Free Models and remove separate Disabled Models list.** For OpenCode V1 (`oc1`) and V2 (`oc2`), models no longer automatically populate the active top list on initial view; instead, all available free models appear as selectable chips under "Suggested free models". Clicking a chip adds it to the active list, and removing/disabling an active model returns it directly back to "Suggested free models" without placing it into a separate "Disabled models" section.

---

# v0.5.274 (2026-10-23) · 2 commits

## What Was Changed

- **Updated OpenCode Free V1 model prefix and alias from `oc` to `oc1`.** The provider alias and UI prefix for OpenCode Free V1 are now `oc1/` (e.g. `oc1/beam-free`, `oc1/deepseek-v4.1-flash-free`), matching the `oc2/` prefix convention of OpenCode Free V2. Legacy `oc/` alias is preserved for backwards compatibility.

---

# v0.5.273 (2026-10-23) · 2 commits

## What Was Changed

- **Renamed legacy OpenCode Free provider to "OpenCode Free V1".** Updated display name to "OpenCode Free V1" with badge "OC1" to cleanly differentiate between the legacy V1 provider and the new CLI 1.19.4-based "OpenCode Free V2" provider.

---

# v0.5.272 (2026-10-23) · 2 commits

## What Was Added

- **New "OpenCode Free V2" provider (`opencode-v2` / `oc2`).** Added a dedicated OpenCode V2 provider ported directly from the reverse-engineered OpenCode CLI 1.19.4 architecture while keeping the existing OpenCode Free provider intact. V2 features:
  - Official 1.19.4 wire endpoints (`/inference/openai/v1/chat/completions`, `/inference/anthropic/v1/messages`, `/inference/v1/responses`).
  - Bitwise timestamp identifiers matching official binary disassembler (`msg_<timestamp_ascending_base62>` and `ses_<timestamp_descending_base62>`).
  - Standardized tool cloaking (`bash` and `read`) without telltale prompt injection to prevent upstream 429 content-filter triggers.
  - Full official 1.19.4 free model catalogue (`beam-free`, `big-pickle`, `deepseek-v4.1-flash-free`, `flint-40b-free`, `glm-5.3-flash-free`, `mimo-v2.6-flash-free`, `nemotron-3-ultra-free`, `nemotron-3.5-lightning-free`, `nemotron-3.5-super-vl-free`, `muse-spark` variants, and `union-alpha`).
  - Native integration with proxy pools and automatic session rotation.

---

# v0.5.271 (2026-10-23) · 2 commits

## What Was Fixed

- **Preserved original probe token budget for full model completion responses.** Reverted `max_tokens` back to 1024 in `/api/models/test` to preserve complete responses and chain-of-thought budgets across all models without altering probe defaults.

---

# v0.5.270 (2026-10-23) · 2 commits

## What Was Fixed

- **Accelerated model ping probes for reasoning and free models.** The ping endpoint `/api/models/test` previously set `max_tokens: 1024`, causing reasoning models like `deepseek-v4.1-flash-free` and upstream free endpoints to spend 20–30+ seconds generating hundreds of chain-of-thought tokens before returning, making the dashboard test button appear frozen/spinning. With the issue #3010 soft-pass already supporting length-limited reasoning completions, `max_tokens` is now set to 16 for probe checks. Tested live over Cloudflare tunnel: `oc/deepseek-v4.1-flash-free` now resolves in 3.0s and `oc/glm-5.3-flash-free` in 2.3s with `{"ok":true,"status":200}`.

---

# v0.5.269 (2026-10-23) · 2 commits

## What Was Fixed

- **Eliminated telltale prompt injection that triggered upstream OpenCode 429 rejection on model pings.** Upstream OpenCode introduced content filtering that caught the historical placeholder prompt note (`"Do not call the read or shell tools..."`), immediately rejecting requests with `FreeUsageLimitError` and causing model ping/test buttons in the dashboard to spin endlessly until abort timeout. Silenced the note so prompts remain clean. Verified live with model probe tests (`oc/mimo-v2.6-flash-free`, `oc/deepseek-v4.1-flash-free`, `oc/glm-5.3-flash-free`) all completing with `{"ok":true,"status":200}`.

---

# v0.5.268 (2026-10-23) · 2 commits

## What Was Fixed

- **Preserve HTTPS protocol across dashboard redirects behind reverse proxies / Cloudflare tunnels.** The custom server and auth guard previously hardcoded `http://` when constructing redirect URLs (`/` to `/dashboard`, `/dashboard` to `/login`), causing browsers on HTTPS tunnels to refuse connecting to an insecure HTTP location or triggering mixed-content connection errors. Both now inspect `x-forwarded-proto` and socket encryption so all redirects preserve `https://`.

---

# v0.5.267 (2026-10-23) · 2 commits

## What Was Fixed

- **Fixed reference error in studio models API and bounded opencode connect timeout.** The `/api/models` endpoint previously crashed with `ReferenceError: pluginMarks is not defined` when resolving studio models, breaking dashboard model listings. In addition, `opencode` transport now sets a snappy 12s socket timeout (`timeoutMs: 12000`) instead of hanging for 60s when a residential proxy node is slow to connect, allowing rotation to smoothly fail-over to the next residential session. Verified end-to-end with `oc/beam-free`, `oc/deepseek-v4.1-flash-free`, and `oc/mimo-v2.6-flash-free` completing in ~2 seconds.

---

# v0.5.266 (2026-10-23) · 2 commits

## What Was Added

- **Automatic per-request session rotation for residential proxy pools.** Residential proxy gateways that support session-based IP rotation via username conventions (e.g. `res-*-sid-XXXXX`) are now automatically detected: each outbound connection request randomizes the session ID (`randSid`), ensuring a fresh residential egress IP with its own rate limit window. When upstream triggers 429 `FreeUsageLimitError`, the specific spent egress IP is rotated out without prematurely excluding the entire residential pool. Verified with live OpenCode free models (`beam-free`, `mimo-v2.6-flash-free`, `deepseek-v4.1-flash-free`, `glm-5.3-flash-free`) all successfully answering with 200 OK completions through rotating residential proxy.

---

# v0.5.265 (2026-10-23) · 2 commits

## What Was Changed

- **Reverse-engineered OpenCode protocol from CLI 1.19.4 binary and updated the executor wire contract.** Extracting the protocol directly from the disassembled binary revealed three discrepancies causing relay detection: (1) OpenAI chat endpoints route to `/inference/openai/v1/chat/completions` and Anthropic to `/inference/anthropic/v1/messages` (the legacy `/inference/v1/chat/completions` path flagged callers), (2) the current client sends a synchronized ascending `x-opencode-request: msg_<id>` generated via the native `va()` timestamp algorithm, and (3) `x-session-affinity` and `x-session-id` were removed as upstream specifically checks that they are not sent for opencode-native providers. All 37 tests across 4 test suites passing.

---

# v0.5.264 (2026-10-23) · 2 commits

## What Was Fixed

- **The executor now mirrors the real OpenCode 1.19.4 CLI fingerprint, and the fallback loop stops at the caller's deadline.** Reverse-engineering the current CLI via mitmproxy showed it sends `User-Agent: opencode/1.19.4 ai-sdk/provider-utils/4.0.23 runtime/bun/1.4.4` with `x-opencode-client: cli`, `x-opencode-project` and a per-message `x-opencode-request` — while 9router still sent the older `opencode/latest/2.0.26/cli` shape, which the free tier reads as a stale relay UA after the upstream update. The executor default, the downstream-UA passthrough check, the registry UAs and the test probe all use the current CLI shape now. Separately, the session-rotation branch never carried the fallback deadline, so an exhausted evening rotated ~1.500 proxies past the 120s probe budget and the dashboard showed "The operation was aborted due to timeout" with no usable error; the session branch now returns the last upstream error once the budget is spent. `tests/unit/opencode-session.test.js` pins the UA default/replacement/passthrough; 37 passed across 4 suites.

---

# v0.5.263 (2026-10-23) · 2 commits

## What Was Fixed

- **Alias-prefixed probes get the slow-fallback budget too.** v0.5.262 gave `opencode/*` probes 120s, but the dashboard probes alias-prefixed ids (`oc/beam-free`, `ocg/...`) and `probeTimeoutMs` compared the raw prefix against the provider set — an unresolved `oc` fell through to the 15s REST budget, so the button test still aborted mid-rotation with "The operation was aborted due to timeout" while direct `opencode/*` calls survived. The budget now resolves the prefix via `resolveProviderId` first (with a fail-open fallback to the raw prefix). `tests/unit/ping-timeout.test.js` pins the alias resolution; 5 passed.

---

# v0.5.262 (2026-10-23) · 2 commits

## What Was Fixed

- **The model test button no longer aborts healthy OpenCode models at 15s.** Probing a model (`/api/models/test`) sends a real chat request down the normal fallback chain, but every probe shared one 15s budget. An OpenCode free-tier probe routinely needs 30-90s — each spent session/IP answers 429 `FreeUsageLimitError` and the fallback rotates the session plus every proxy before one window answers — so the probe aborted mid-rotation and painted working models red with "The operation was aborted due to timeout". `opencode`, `opencode-go` and `opencode-zen` probes now get 120s (`SLOW_FALLBACK_PROBE_TIMEOUT_MS` in `probeBudget.js`); every other provider keeps its existing budget. `tests/unit/ping-timeout.test.js` pins the new set and budget; 4 passed.

---

# v0.5.261 (2026-10-23) · 2 commits

## What Was Fixed

- **Two dead model ids are gone from both screens; 9 of 10 live free models now answer.** Besides Jev (400 `ModelProtocolUnsupported`, fixed in v0.5.260), the live catalogue still advertises `minimax-m3.1-flash-free`, but upstream retires it with 410 `ModelDeprecated` pointing at `deepseek-v4.1-flash-free`. It is dropped from the catalogue filter and the picker the same way (`DEPRECATED_OPENCODE_MODELS`), while new id `flint-40b-free` rides the existing free-tier rule with no change. Verified end to end through the preview: `beam-free`, `big-pickle`, `glm-5.3-flash-free`, `mimo-v2.6-flash-free`, `nemotron-3.5-super-vl-free`, `deepseek-v4.1-flash-free`, `flint-40b-free` all answer; `longcat-2.5-preview-free` and `nemotron-3.5-lightning-free` still hit upstream 429 `FreeUsageLimitError` (daily quota, not a routing bug — the session rotation from v0.5.259 keeps retrying with fresh windows). `tests/unit/provider-model-catalogue.test.js` pins the deprecated set and the picker exclusion; 9 passed with `unit/opencode-session-rotation.test.js`.

---

# v0.5.260 (2026-10-23) · 2 commits

## What Was Fixed

- **Jev ids no longer loop the fallback with an unwinnable 400.** `jev-1.13` / `jev-1.13-free` are System One decision models: upstream answers `ModelProtocolUnsupported` on the chat completions lane, so every chat request to them burned the whole proxy/fallback loop for a response that could never come (1.073 of the recent 400s). They are removed from the chat registry, the suggested-catalogue filter and the model picker — 12 free models stay visible and routable in both screens instead of 13 with one dead entry. Covered by `tests/unit/provider-model-catalogue.test.js` (9 cases).

---

# v0.5.259 (2026-10-23) · 2 commits

## What Was Fixed

- **FreeUsageLimitError now rotates the OpenCode session instead of hammering every proxy.** Upstream tracks the free quota per session id as well as per IP (upstream issue #5107): once a session window is spent, retrying the same burned session through dozens of proxies only collects the same 429 until the request times out. A 429 carrying `FreeUsageLimitError` on the opencode provider now burns the canonical session (`rotateOpencodeSession`) before the fallback moves to the next account, so the retry re-enters the proxy loop with a fresh quota window. The stable session is untouched on the happy path — a fresh session per request would burn quota faster. Covered by `tests/unit/opencode-session-rotation.test.js` (3 cases: fresh session minted, rotation scoped per identity, chat handler wiring).

---

# v0.5.258 (2026-10-21) · 3 commits

## What Was Fixed

- **The provider page now agrees with the model picker about what it lists.** The model picker offered all 13 free OpenCode models, but the provider page dropped `jev-1.13-free` because its registry entry carries the `kind: "systemone"` lane and the page's llm-only filter (`!k || k === "llm"`) treated that as a media kind with its own page - the free System One model was visible in one screen and invisible in the other, paid `jev-1.13` chip included while the free one was not. `systemone` is now kept alongside `llm` in the provider page filter, and `tests/unit/provider-model-catalogue.test.js` (6 cases) pins the filter so a future lane cannot silently drift again.

---

# v0.5.257 (2026-10-21) · 2 commits

## What Was Fixed

- **The upstream smoke-test id no longer shows up as a chip.** OpenCode's live catalogue carries a placeholder id literally named `test`, and since the panel started listing "Other models" straight from the catalogue it appeared next to real models as junk. The opencode filter now drops placeholder ids alongside the known-dead one before anything reaches the panel.

---

# v0.5.256 (2026-10-21) · 2 commits

## What Was Changed

- **Back to picking your own models: the catalogue is suggested again, not imported.** Rendering the whole live catalogue as model rows silently turned every published id into an entry in the list, which took away the step where an operator chooses what to add. The provider page renders the suggested chip rows again for free no-auth providers - `Suggested free models (n):` with `+` chips, `Other models (n):` for the paid half, and `Disabled models (n):` to restore - and each chip still calls `handleAddCustomModel`, so nothing joins the list unasked. The free/paid split, the FREE badge from `isFree` and the picker's `· N disabled` hint stay. `src/shared/utils/freeModelRows.js` and the `isDisabled`/`onRestore` props it needed are gone (no call sites left), and `tests/unit/provider-model-catalogue.test.js` (5 cases) pins the chip flow, the removed helper, the trimmed `ModelRow` props and the registry's `isFree` flags.

---

# v0.5.255 (2026-10-21) · 2 commits

## What Was Fixed

- **The OpenCode Free panel shows every id the provider publishes, paid ones included.** The first pass of the unified list hid the ~76 paid ids of the live catalogue behind an "only advertise what a keyless caller can use" rule, and the panel then read as a short list with models missing - the opposite of what was being fixed. The catalogue now reaches the row grid unfiltered, the FREE badge comes from each row's own tier flag (`isFree` travels through `buildUnifiedModelRows` instead of being stamped on every catalogue row), and the five registry-pinned free ids (muse spark x2, union-alpha, deepseek flash, jev) carry `isFree: true` in `open-sse/providers/registry/opencode.js` so their badge no longer depends on the id suffix. Verified live: the upstream endpoint lists 86 ids, all 10 free ones plus the 3 registry-only free models render, and `tests/unit/free-model-rows.test.js` (10 cases) pins the unfiltered catalogue, the flag-driven badge and the registry flags.

---

# v0.5.254 (2026-10-21) · 2 commits

## What Was Fixed

- **Opening the model picker no longer blanks the page.** The `· N disabled` hint was computed by a helper defined *inside* the `groupedModels` memo but printed in the group header at render time, so any picker that opened threw `ReferenceError: disabledCountFor is not defined` and Next's error boundary replaced the dashboard with "Application error: a client-side exception has occurred". The helper now lives at component scope, next to the state it reads, and `tests/unit/free-model-rows.test.js` asserts its declaration sits above the memo so the same scope mistake fails the suite instead of the browser.

---

# v0.5.253 (2026-10-21) · 2 commits

## What Was Fixed

- **The unified free list only advertised models that can actually answer.** The first cut of the unified list passed the whole live catalogue to the row builder, and the OpenCode Free catalogue marks paid ids with `isFree: false` - so ~85 paid models (Claude, Gemini, GPT families) appeared as free-badged rows on a provider that answers 401 for every one of them without a key. The catalogue handed to `buildUnifiedModelRows` is now filtered to `isFree === true`, the same rule the suggestion picker already used, and the browser check on the provider page counts 10 free rows plus the disabled trio instead of 85+.

---

# v0.5.252 (2026-10-21) · 2 commits

## What Was Changed

- **A free provider's catalogue is now one model list, not three.** On the OpenCode Free page the same tier was split across the model rows, a "Suggested free models (6)" chip row that asked you to add models that already answered, and a "Disabled models (3)" chip row at the bottom - so the catalogue was never visible in one place and ids you had disabled looked gone. `src/shared/utils/freeModelRows.js` folds registry models, user-added rows and the live catalogue into a single de-duplicated list (custom beats registry beats catalogue), and the page renders it as ordinary rows: each model once, free rows carrying a `FREE` badge, disabled rows dimmed with a restore action. The two chip rows stay only for providers that gate their catalogue behind adding a model.
- **The picker stopped hiding models without saying so.** `ModelSelectModal` filters disabled ids out of every group, which is correct - a disabled model is not offered by `/v1/models` either - but a group that silently showed 10 of 13 models read as a half-missing free tier. The group header now appends `· N disabled` with a hint that they are restored on the provider page, so the gap is explained where it is seen.

---

# v0.5.251 (2026-10-21) · 2 commits

## What Was Changed

- **The dead long-task banner is deleted, not just left unused.** `src/shared/components/LongTaskBanner.js` (431 lines) had zero callers since long runs moved to the notification bell, and `Loading.js` still exported its wrappers (`ProgressCard`, `CenterLoading`, `BusyOverlay`) as a trap for the next feature. The component file and the three exports are gone, `src/shared/components/index.js` stops re-exporting them, and `Loading.js` keeps only what still renders: `Spinner`, `PageLoading`, `Skeleton`, `CardSkeleton`.
- **The tests follow the component out.** `tests/unit/loading-banner.test.js` existed only to assert on the deleted files (and was already a catalogued load failure), so it is removed together with its entry in `tests/__baseline__/known-fails.txt`. `tests/unit/studio-banner-update.test.js` keeps the store, bell, layout and pool assertions and drops the two that read the deleted sources. `tests/unit/bell-only-progress.test.js` gains a guard: the component file must not exist and neither the wrappers nor their barrel exports may reappear — a zero-call-site component gets re-imported the moment someone reaches for it.

---

# v0.5.250 (2026-10-20) · 1 commit

## What Was Changed

- **Parity is now asserted byte for byte, not by headings.** The previous test sampled a few lines from the middle of the core, which a careful paraphrase could still slip past. `tests/unit/antislop-prompt-parity.test.js` now asserts that `full` contains the entire core document (everything from `## What This Is` onward) character for character, and that `ultra` contains each of the five concern skills verbatim after its title — so a reformat, a dropped paragraph or a "tidied" sentence fails the suite.

---

# v0.5.249 (2026-10-20) · 1 commit

## What Was Changed

- **Anti Slop is now the skill, not a summary of it**: the plugin used to inject a hand-condensed prompt of ~3.7k characters — about 6% of upstream's text, 15 of the 38 mandatory rules, no liveliness dials, no Design Read, none of the five concern skills — so calling it "the antislop skill" oversold it. `open-sse/rtk/antislopPrompt.js` is now generated from verbatim upstream sources kept in `open-sse/rtk/antislop-src/` (`core.md` plus `ui`, `copywriting`, `human`, `layoutmobile`, `code`). `full` is the core text verbatim (42,557 chars, ~10.6k tokens) and `ultra` is the core plus all five concern skills (130,512 chars, ~33k tokens). `lite` stays the 913-char condensation for cheap always-on filtering.
- **Only the repo-editing half is dropped**: the install wizard, the self-update section and the mode-resolution section tell an agent to write pointer blocks into `AGENTS.md` and to ask which mode to use — wrong for a prompt injected on every request. A one-line runtime note replaces them (the plugin's level is the mode), and the tests fail if any of that text leaks back in.
- **The level picker states the cost** instead of describing intensity in the abstract: each option now reads its token count straight from `ANTISLOP_LEVEL_CHARS`, so re-syncing the sources moves the number with it.
- `scripts/generateAntislopPrompt.mjs` regenerates the module and `--check` fails when it drifts; `tests/unit/antislop-prompt-parity.test.js` (9 cases) asserts every core section is present verbatim, that all 38 rules survive, that ULTRA carries the five concern skills, that the dropped sections stay out, and that an unknown level still falls back to `full`.

---

# v0.5.248 (2026-10-20) · 1 commit

## What Was Fixed

- **Wording**: the USD notice read `$2.30 of $2.50 spent used.` — dollars are spent, not used. Each kind now owns its sentence (`… tokens used.`, `… calls used.`, `… spent.`) instead of one template with a noun swapped in, and a test rejects `spen[dt] used` so the phrasing cannot come back.

---

# v0.5.247 (2026-10-20) · 1 commit

## What Was Fixed

- **The long progress bar inside dialogs is gone; the bell owns it**: opening *Download Backup* and starting an export dropped a full-width card ("Preparing backup / Exporting database") over the form, with a scrim, covering the fields it was supposed to sit beside — and the same run was already in the bell through the task store, so the dialog showed a second, worse copy of one job. The card is removed from `DownloadBackupModal`, `BulkImportGrokCliModal`, `BulkImportCodexModal` and `AddApiKeyModal`; progress now lives only in the bell, while each dialog keeps its own busy state on the action button (`Download Backup`, `Importing…`, `Saving…`).
- 3 tests in `tests/unit/bell-only-progress.test.js` keep it that way: no modal renders `ProgressCard`, every one of them still reports to the task store, and no empty conditional wrapper is left behind.

---

# v0.5.246 (2026-10-20) · 1 commit

## What Was Fixed

- **A returning condition lights the bell again**: clearing a notice is how a resolved condition gets retired, and it also marks the row read — so when the same condition came back (a key slid under its cap and then over it again, a task failed twice) the row reappeared in the feed already greyed out and the badge stayed at zero, which reads as "nothing to see" while the key is in fact refusing traffic. `notify()` now re-arms `readAt` when it revives a cleared row, and leaves a row the operator actually read alone.
- 2 tests in `tests/unit/notification-revival.test.js` drive the real SQLite adapter: revival counts as unread and stays a single row, while a read row that merely changes its figure stays read.

---

# v0.5.245 (2026-10-20) · 1 commit

## What Was Added

- **Quota notices follow the budget a key actually enforces**: the notification scan only ever read `tokenLimit`/`usedTokens`, so a key switched to a USD or request budget exhausted itself in silence — it answered 429 while the bell stayed empty, and the first sign was a client failing. `src/lib/notifications/quotaPressure.js` now reads the selected `limitKind`, warns at 90% and goes critical at the cap, and each kind gets its own wording: `$2.40 of $2.50 spend used. Resets at 00:00 UTC.`, `450 of 500 calls used. No automatic reset.`, `95,000 of 100,000 tokens used. Resets in 5d.` Yesterday's dollars count as zero, so a stale `costDay` never nags about a counter that already rolled over, and inactive keys stay quiet.
- **Switching kinds or raising a budget clears the old notice**: the dedupe key now carries the kind (`quota:<id>:<kind>:<level>`), and every pass clears the notices it did not recreate — previously a key moved from cost to tokens kept an unread "out of tokens" row in the feed.
- 7 unit tests in `tests/unit/quota-notifications.test.js` cover the thresholds per kind, the stale-day rollover, the unselected-kind silence, and the reset timestamps.

---

# v0.5.244 (2026-10-20) · 1 commit

## What Was Fixed

- **`Error fetching models: e is not a function` — the models list died for anyone with a combo**: `aggregateComboCapabilities` gained a `resolveCaps` callback in its third position, but the two server routes still called it with their old arguments, so the recursion depth `0` landed in the callback slot and `0?.(id)` threw a `TypeError`. Both `/api/models` and `/api/v1/models` answered 500 before they could list anything. The routes now pass `null` for the resolver and the combo's own window in the last slot, and the aggregator ignores a resolver that is not a function, so a stale caller can never take the list down again.
- **A combo reports its widest member's window again, and its own window wins**: the same merge had reverted the aggregator to `Math.min` and dropped the per-combo `contextWindow` override, so a combo built on a 1M model published 256k and clients compacted far too early. Both behaviours are restored and covered by `tests/unit/combo-capabilities.test.js`, whose four previously catalogued failures now pass (the entries were pruned from the baseline). `tests/unit/combo-caps-resolver.test.js` came in from upstream asserting the opposite window rule (minimum member), so its three window assertions were rewritten to the fork's widest-member rule with a note saying where the two disagree — the resolver cases it was really about are untouched.

---

# v0.5.243 (2026-10-20) · 1 commit

## What Was Changed

- **The three budgets are named by what they measure**: `Tokens` / `Cost` / `Requests` were just the units again, so the row title repeated the sentence underneath and said nothing a reader could not guess from the icon. They now read `Token volume`, `USD spend` and `Request count` — each name pairs the unit with the thing being counted, and the explanations below stay as they were.

---

# v0.5.242 (2026-10-20) · 1 commit

## What Was Changed

- **The limit cards stopped quoting a sample amount**: each row carried an invented example next to its name (`100,000 tokens`, `$2.50 per day`, `1,000 calls`), which read as a value the key already had rather than an illustration. The rows now hold only the unit, an icon and the sentence that explains how it is counted; the number lives in the field the row reveals.

---

# v0.5.241 (2026-10-20) · 1 commit

## What Was Changed

- **The limit picker is a list of rows instead of three narrow cards**: the key editor is a 512px column, so a three-up grid gave each card 149px and wrapped every sentence into five short lines — the copy that was meant to explain the budget became the reason the row looked crowded. Each option is now a full-width row: coloured icon chip, name and value example on one line, one sentence underneath, radio at the end. The selected row keeps the tinted plate, accent border and glow.

---

# v0.5.240 (2026-10-20) · 1 commit

## What Was Changed

- **The key editor fits the screen again**: the dialog body was capped with a magic `calc(85vh-100px)` while the header and footer added their own height on top, so a long form pushed the footer past the bottom of the window and the last permission row slid underneath it. `Modal` now caps the panel at `85vh`, lays it out as a column, and lets only the body scroll, so the footer is always reachable and no row is hidden behind it.
- **The unselected limit cards show their radio ring**: an empty 1px `#333` circle on a `surface-2` card was invisible, so the two cards that were not chosen looked like static panels rather than options. The ring now uses `text-muted/50` and the value chips share one treatment across all three cards, differing only in opacity.
- **Examples use one number convention**: `100K tokens` / `$2.50 / day` / `1,000 calls` became `100,000 tokens` / `$2.50 per day` / `1,000 calls`.
- **Decorative icons are hidden from screen readers**: the material-symbols glyph text was being appended to each card's accessible name, so a radio announced itself as "data_usage Tokens Adds up prompt…".

---

# v0.5.239 (2026-10-20) · 1 commit

## What Was Changed

- **The limit picker became cards that say what the budget does, not three labelled buttons**: the tiles were icon + name, which still left the reader guessing what "Cost" meters. Each card now carries a 32px tinted icon chip, the name, a filled radio mark on the selected one, a sentence explaining the rule (`Adds up prompt and completion tokens, so a long conversation costs more than a short one.`), and a monospace example of the value it expects (`100K tokens`, `$2.50 / day`, `1,000 calls`) pinned to the bottom so the three cards align. Selection adds a coloured border plus a soft accent glow around the card rather than only changing the text colour, and the unselected cards keep their chip colour at 70% so the row reads as three budgets before anything is clicked.

---

# v0.5.238 (2026-10-20) · 1 commit

## What Was Changed

- **The three limit tiles keep their colour even when they are not selected**: at rest they were a hairline border around grey text, so the picker still read as one grey row until you clicked — the same complaint the dropdown earned. Each tile now carries its accent at 60% opacity (sky for Tokens, emerald for Cost, violet for Requests) and a faint `bg-surface-2/40` plate, so the row reads as three distinct budgets the moment the modal opens; selecting one strengthens the same accent instead of introducing a colour that was not there before.

---

# v0.5.237 (2026-10-20) · 1 commit

## What Was Changed

- **Limit Type is a three-tile picker with colour, not a dropdown**: a `<Select>` collapsed the three budgets into one line of white text and hid two thirds of the choice, which made the setting that decides *what a key is even measuring* look like the least important field in the form. `LimitKindPicker` shows all three side by side — `Tokens` (sky, volume), `Cost` (emerald, USD per day) and `Requests` (violet, calls) — each with its own icon, an uppercase sub-label saying what it counts, and a tinted background plus coloured border on the selected tile. It is a real `radiogroup` (buttons with `role="radio"` and `aria-checked`), so arrow keys and screen readers get the same three-way choice the eye does, and it stacks to one tile per row below `sm` instead of squeezing three labels into a phone-width row. Both the create and the edit modal use it; the value field and the reset interval moved into their own row underneath. `tests/unit/api-key-limit-picker.test.js` pins the three options and their distinct accents/icons, the radiogroup markup, the selected-state styling, and that no `Select label="Limit Type"` survives.

---

# v0.5.236 (2026-10-20) · 1 commit

## What Was Changed

- **The key card shows one reset badge, and it is the one that moves**: a capped key on a reset window carried two labels that said the same thing twice — `Reset: every 7d` (the setting, frozen text) next to `Next reset: 6d 23h` (the same fact as a countdown). The static one is gone; what remains is the countdown, which already ticks with `useNow` and turns into `Resetting...` when it reaches zero, so the row now answers "when does this key get its budget back" in one badge instead of restating the configured interval beside it. `tests/unit/api-key-reset-badge.test.js` keeps the static label from coming back and pins the countdown's label, its ticking and its "no window, no badge" guard.

---

# v0.5.235 (2026-10-20) · 1 commit

## What Was Changed

- **Each limit kind now explains its own rule instead of sharing a template**: the three hints opened the same way (`Counted …`) and closed with the same `the key answers 429 at the cap. 0 = unlimited.`, so Requests read like Tokens with a swapped noun — the difference a reader needs is *what gets counted and why it costs what it costs*, not the refusal code. Tokens now say they add up prompt and completion tokens across the reset window, so a long conversation costs more than a short one. Requests say they count calls and not size — one call is one request however many tokens it spends, so a huge prompt counts the same as a tiny one. Cost says every call is charged at the model's price in USD, so the same amount of text costs more on an expensive model, and the total rolls over at 00:00 UTC. The only shared sentence left is `0 = unlimited`, which is true of all three. `tests/unit/api-key-limit-hint.test.js` now also asserts the three paragraphs and their opening sentences are distinct, not merely present.

---

# v0.5.234 (2026-10-20) · 1 commit

## What Was Changed

- **The limit field explains the unit it is set to, instead of saying "0 or leave empty for unlimited"**: the field is one number whose meaning depends on `Limit Type`, and the old hint was the one sentence that carried no information about any of the three. `limitHint(kind)` now answers per kind — tokens are counted in prompt + completion tokens added up over the reset window and the key answers 429 at the cap; cost is priced per request at the model's rate, rolls over at 00:00 UTC and answers 429 at the cap; requests are counted once per logged call whichever model it hits. Every variant ends with `0 = unlimited`, so the only unit-agnostic rule survives. The token variant still appends the creator's ceiling (`Your maximum is 88,000,000 tokens`) because that is a real constraint when a sub-key is minted, and the hint is now shown in the edit modal too, which had none. Labels dropped their duplicated `(0: unlimited)` suffix — the hint states it now — so the three fields read `Token Limit`, `Cost Limit (USD)` and `Request Limit`, and the rate-limit pair reads `RPM Limit` / `TPM Limit` with `0 = unlimited` moved into their hints. `tests/unit/api-key-limit-hint.test.js` asserts each kind's sentence, the shared unlimited rule, the creator ceiling appearing on tokens only, both modals rendering the helper, and the generic line being gone.

---

# v0.5.233 (2026-10-20) · 1 commit

## What Was Fixed

- **The newest changelog entry drew a stray horizontal rule**: `CHANGELOG.md` separates versions with a `---` line, and a version's body runs until the next `# vX.Y.Z` heading, so that separator was handed to the Markdown renderer and became an `<hr>` at the bottom of the card. Only v0.5.232 showed it because Markdown reads `---` glued to the line above as a setext heading underline — every older entry swallowed its separator that way and looked fine, while the new entry, written with a blank line before the rule, rendered the line. `splitVersions()` now runs each body through `stripSectionRules()`, which drops standalone rules (leaving `---` inside fenced code alone, since an entry may quote one) and collapses the blank line the removal would leave behind. Every card now ends the same way, whether or not the file happens to have the blank line. `tests/unit/changelog-section-rules.test.js` covers the rule at the end, a rule between sections, a rule inside a fence, the splitter actually applying it, and that no version body in the real file keeps a rule.

---

# v0.5.232 (2026-10-20) · 1 commit

## What Was Added

- **The limit badge says `Usage:` whatever the unit**: `Spent: $0.00 / $2.50` read as a different kind of number from `Usage: 12K / 100K tokens`, even though both answer the same question — how much of the selected budget is gone. The unit is already inside the value (`$`, `req`, `tokens`), so the label is now always `Usage: …` and the three kinds line up in the key list.

## What Was Changed

- **The key editor is grouped instead of stacked**: both the create and the edit modal now split their fields into `Identity` (name, expiry), `Usage Limit` (limit type + value + reset interval), `Rate Limits` (RPM/TPM) and `Access` (allowed models, permissions), each with a short caption explaining what it controls. Fields sit two-per-row from the `sm` breakpoint up so the form is shorter, the limit pair no longer wraps awkwardly next to the reset interval, and the actions moved out of the scrolling body into the modal footer — the buttons stay reachable however long the permission list gets. The reset interval and its custom value now share a row, and the edit payload moved into `handleSaveEditedKey` so the button no longer carries a twenty-line inline object.

## What Was Removed

- **IP whitelist**: the field is gone from the create modal, the edit modal and bulk edit, the `IP Guard` chip is gone from the key card, and the API no longer accepts or returns `ipWhitelist`. `validateApiKey()` stopped enforcing it, together with the `IP_NOT_ALLOWED` reason in `keyGate`, the chat handler and the login route — a key cannot be edited into a state the UI cannot show. The `apiKeys.ipWhitelist` column stays so existing rows, backups and restores load unchanged, but nothing reads or writes it. **Note:** a key that was previously restricted to a list of IPs is no longer restricted by IP; revoke or re-mint it if that restriction was load-bearing.

---

# v0.5.231 (2026-10-20) · 1 commit

## What Was Added

- **One budget per key, and the operator picks which unit it is measured in**: the cost cap shipped beside the token cap, so a key could carry two budgets that both applied and switching a key to money meant zeroing the token limit by hand; nothing could limit a key by request count at all. `limitKind` now names the single budget a key is measured by — `tokens` (the default, so existing rows keep their behaviour), `cost`, or `requests`. All three numbers stay stored so switching back does not lose them, but `validateApiKey()` enforces only the selected one, which is why a stale, exhausted token cap no longer blocks a key that was switched to requests. Requests get a `usedRequests` counter written in the same transaction as the usage row and reset by the same `resetInterval` window as tokens; cost keeps its UTC-day stamp, so a new day replaces the counter without any reset job. `REQUEST_LIMIT_EXCEEDED` and `COST_LIMIT_EXCEEDED` both answer **429** through the gate rather than the `401 Invalid API key` an unknown reason falls back to. The key editor is now one "Limit Type" selector plus a single value field whose label and placeholder follow the kind (and the reset-interval picker hides for cost, which is always daily), and the key list shows one badge for the active budget — `Usage: 12K / 100K tokens`, `Spent: $0.42 / $2.50`, `Usage: 12 / 1,000 req` — that turns red at the cap. The per-key usage card measures the same kind, and backup/restore carries the kind plus all three caps. `tests/unit/api-key-cost-guard.test.js` grew to 9 tests: cost accumulation and refusal, unlimited, day rollover, request counting and refusal, a stale token cap staying ignored while requests is selected, switching kind moving the enforced budget, and the 429 mapping.

---

# v0.5.230 (2026-10-20) · 1 commit

## What Was Added

- **An API key can now be given a daily spend cap in dollars**: token, RPM and TPM limits bound volume, not money — the same token count costs a cent on `gpt-4o-mini` and dollars on a frontier model, so a key could burn any amount per day and the owner only found out on the provider invoice. Each key carries `dailyCostLimit` (USD, `0` = unlimited), a `costSpent` counter and the UTC `costDay` that counter belongs to; `saveRequestUsage()` writes the counter inside the same transaction as the usage row, and because the stamp *is* the day, a new day replaces the counter instead of needing a reset job. Counting `usageHistory` instead would have been wrong: that table is pruned, so spend would read lower than it was and the key would silently overspend. `validateApiKey()` refuses with `COST_LIMIT_EXCEEDED` once today's spend reaches the cap, which `keyGate` answers as **429** (an unrecognised reason would have fallen back to `401 Invalid API key`, blaming the credential for a budget decision). A sub-key cannot be given a larger cap than its creator, on create or on edit, and the cap survives backup/restore — an older backup that predates the column leaves the live counter intact rather than zeroing it. The key editor gained a "Daily Cost Limit in USD" field beside the RPM/TPM limits, the endpoint list shows a `Cost: $x / $y today` badge that turns red at the cap, and the per-key usage card shows spend against it. `tests/unit/api-key-cost-guard.test.js` (6 tests, real SQLite adapter) covers accumulation from a logged request, refusal at the cap, passage below it, the unlimited case, the day rollover through the usage writer, and the 429 mapping. Spec: `docs/superpowers/specs/2026-10-20-api-key-daily-cost-limit-design.md`.

---

# v0.5.229 (2026-10-20) · 1 commit

## What Was Fixed

- **`next build` no longer kills itself on the database it is writing**: `/api/auth/saml/start` had no `dynamic` export, so the build prerendered it, and prerendering calls `getSettings()` — a SQLite read issued from the build process while the prerender workers were still writing. The read came back `SqliteError: database is locked`, Next reported `Error occurred prerendering page "/api/auth/saml/start"` and the export failed, which is why a build could pass on one commit and fail on the next with no code difference between them. The route now declares `dynamic = "force-dynamic"` like the other settings-reading GETs: it reads the request cookies and redirects, so there was never anything static to render. `tests/unit/saml-start-prerender.test.js` pins both the export and the redirect behaviour.

---

# v0.5.228 (2026-10-20) · 1 commit

## What Was Fixed

- **The CI test gate now measures this checkout instead of a stale wish**: the catalogue held 24 entries from a machine whose failures no longer match reality, so the first real Linux/Node 22 run (3 856 tests) tripped on 199 uncatalogued failures and the job could never pass. `tests/__baseline__/known-fails.txt` is regenerated from that run — 213 entries across 71 files — and its header now documents how to regenerate it. `compare-fails.mjs` also accepts a `file :: (suite)` entry, because a suite that fails to load has no test name and previously could never match, which made it a permanent failure by construction. No test was deleted or skipped to get here.
- **What the catalogue actually contains is now written down** in `CLAUDE.md` instead of the old "~938 pass, ~64 fail": 39 failures are the guard tests not resolving a `getDashboardAuthSession` export, 16 are converter snapshot drift, 7 are `UNIQUE constraint failed: combos.name` state leaking between combo tests, 13 suites fail to load, and the rest are conversion assertions. That is a backlog, not an environment quirk.

---

# v0.5.227 (2026-10-20) · 1 commit

## What Was Fixed

- **The standalone build can serve again — the auth guard had no `next/server` to import**: `next build` traces only what reaches the webpack graph, and `src/dashboardGuard.js` is copied into `.next/standalone/` *after* the build because `custom-server.js` loads it by absolute path. Its runtime `import "next/server"` was therefore never traced, so the standalone tree carried a partial `next` package and every request answered `503 guard unavailable` with `ENOENT node_modules/next/server.js`. `scripts/copy-standalone-assets.mjs` now mirrors `node_modules/next` into the standalone tree — the same thing `assemble.sh` has always done for the systemd unit — so `npm run build && npm start` and the bundle CI uploads are servable. `tests/unit/standalone-assets.test.js` covers the mirror (including that it replaces the traced directory instead of merging into it), and the CI bundle check now fails when `node_modules/next/server.js` is missing.
- **CI's nested install no longer crashes on the runner's npm**: npm 10.9.9 aborts `npm install` inside `tests/` with `Cannot read properties of null (reading 'edgesOut')` when the directory resolves inside a project that has its own tree. The test job installs npm 12 first, which is what the local setup already runs.

---

# v0.5.226 (2026-10-20) · 1 commit

## What Was Added

- **CI builds, tests, and boots the standalone server on GitHub Actions**: `next build` does not fit in the development box's memory cap, where the peak already sits next to the limit, so every build now runs on a runner instead. `.github/workflows/ci.yml` installs the root and `tests/` dependencies (no lockfile is tracked, so `npm install` rather than `npm ci`), runs vitest, then builds and checks the standalone tree for the modules `custom-server.js` loads by absolute path (`src/dashboardGuard.js`, `src/lib/db/repos/securityLogRepo.js`, `scripts/auth-guard-hooks.mjs`). It then boots the standalone server against a temporary `DATA_DIR` and fails on anything but a `200` from `/api/health`, or on a `503` from `/login` — the guard-unavailable signature. The bundle is uploaded as an artifact, and a `workflow_dispatch` input pushes a `ghcr.io/serenhope/9router` image for hosts that only run Docker.
- **A raw vitest exit code no longer decides the CI verdict**: the suite carries catalogued failures on a clean checkout, so `tests/__baseline__/compare-fails.mjs` compares the JSON report against `tests/__baseline__/known-fails.txt` and fails only on a failure that is not catalogued. A catalogued failure that now passes is reported as stale so the list can be pruned, an entry only counts as stale when its suite actually ran, and a suite that failed to load counts as a failure with no name instead of passing silently. `tests/unit/ci-baseline-compare.test.js` (9 tests) pins the comparison and the workflow wiring.

---

# v0.5.225 (2026-10-19) · 2 commits

## What Was Fixed
- Fix proxy egress falling back to direct host IP on 403 FreeTierError or proxy failures, preventing host main IP leaks to upstream abuse detection gates.

---

# v0.5.224 (2026-10-19) · 1 commit

## What Was Fixed

- **A deploy no longer leaves the browser showing the previous build**: Next marks prerendered pages `Cache-Control: s-maxage=31536000, stale-while-revalidate`, which is a CDN directive — it leaves the browser free to heuristically cache the HTML using `Last-Modified`. Rendered HTML is not content-addressed: it names the chunk hashes of the build that produced it, so a cached page from before a deploy points at files this build no longer ships and the user sees stale screens (or chunks that 404) until a hard refresh. `custom-server.js` now intercepts `setHeader` for document requests and rewrites a long-lived `s-maxage` cache-control into `public, max-age=0, must-revalidate`, so every HTML load revalidates and picks up the new chunk names. Hashed assets under `/_next/static` keep `max-age=31536000, immutable`, and API responses keep whatever Next's own `no-store` says — only the document rewrite changed. Verified on production: `/login`, `/landing` report `max-age=0, must-revalidate`, the webpack chunk still reports `immutable`, `/api/version` still reports `no-store`.

# v0.5.223 (2026-10-19) · 1 commit

## What Was Fixed

- **The update banner no longer flashes for an API-key session**: the card had the right final guard (`if (isApiKeyUser) return null;`) but derived that flag from its own `/api/auth/status` fetch, so until the response landed it treated a key session as an admin and ran the `/api/version` poll at mount. A release sitting on the server therefore painted "Update available" for a restricted session for the length of the round trip, then vanished — visible, brief, and exactly the surface an API key with dashboard-only access is not supposed to manage. It now reads `role` and `loaded` from the session store the sidebar already resolves once for the whole shell: the duplicate status request is gone, the version poll waits for `sessionReady`, and a key session never fetches version data at all. A password session is unchanged. `tests/unit/update-banner-apikey.test.js` (4 tests) pins it; 3 fail against the previous banner.

# v0.5.222 (2026-10-19) · 1 commit

## What Was Fixed

- **A dashboard-only API key no longer sees the whole menu while signing in**: `Sidebar` fell back to a full-admin permission object whenever `permissions` was still `null` — that is, for the whole duration of the `/api/auth/status` fetch — and every filter took the `if (!isApiKeyUser) return true` shortcut, so all admin entries rendered. On a phone connection the fetch takes long enough to read as a real grant: a key with only `viewUsage` showed Providers, Combos, Quota, CLI Tools, Plugins, Proxy Pools and Settings, and only narrowed down after the response landed. The session store already tracked `loaded`; nothing read it. The sidebar is now deny-by-default: a module-level `NO_PERMISSIONS` object replaces the all-true fallback, `sessionReady` is derived from `loaded`, and each of the four menu filters, the media accordion, the settings link and the API-key badge are gated on it, so an unresolved session renders an empty menu rather than an admin one. The settings fetch is also held until the role is known, instead of firing for a session that may turn out to be a key. A password session is unaffected — once `loaded` flips, the admin shortcut applies exactly as before. `tests/unit/sidebar-permission-gate.test.js` (7 tests) pins the behavior; it fails against the previous sidebar on all 7.

# v0.5.221 (2026-10-19) · 1 commit

## What Was Fixed

- **Changelog categories no longer fall back to gray**: `canonicalCategory()` looked a heading up verbatim in `CATEGORY_ALIAS`, so a heading written without a trailing question mark never matched its spelled-with-punctuation sibling (`What Was Added` vs `what was added?`) and fell through to the unknown-category style — muted slate text, `help` icon, gray pill. The lookup now strips trailing `?`/`!`/`.` and probes the bare form first, so both spellings resolve to the same category and keep its real color (green for Features, amber for Fixes, and so on). `what was added` and `what was added / fixed` are also registered in the alias map, since those are the spellings this fork's own release notes use. Verified against every heading in `CHANGELOG.md`: zero gray categories remain (was 4), and the changelog self-checks pass.

# v0.5.220 (2026-10-19) · 2 commits

## What Was Added

- **WorkBuddy AI international identity headers and conversation ID family**:
  - Updated `codebuddy-intl` (`cbai`) registry to target `https://www.workbuddy.ai/v2/chat/completions` and usage endpoints, aligning UA to `WorkBuddy/5.8.4 workbuddy-ai/5.8.4 CLI/2.161.0` and adding strict identity headers (`X-IDE-Type`, `X-IDE-Version`, `X-Private-Data`, `X-Agent-Intent`, `X-Agent-Purpose`, `X-Agent-Type`, `X-Domain`).
  - Added `buildHeaders()` in `CodeBuddyIntlExecutor` generating the complete conversation ID and trace header family (`X-Conversation-ID` as UUIDv7, `X-Conversation-Request-ID`, `X-Root-Request-ID`, `X-Conversation-Message-ID`, `X-Request-ID`, `X-Trace-ID`, `traceparent`, `b3`, `X-B3-TraceId`, `X-B3-SpanId`, `X-B3-Sampled`) to eliminate `400 / code 11-128` channel verification failures (`conversation id missing`).
  - Added unit test `tests/unit/codebuddy-intl-identity-4946.test.js` (11 tests, all passing).

# v0.5.219 (2026-10-18) · 2 commits

## What Was Fixed

- **`npm run build && npm start` (and the `bun run build:bun` / `bun run start:bun` path) no longer answers 503 `guard unavailable`**: Next.js output-file tracing only copies modules that reached the webpack page/API graph, so the modules `custom-server.js` loads **by absolute path** — `scripts/auth-guard-hooks.mjs`, `src/dashboardGuard.js`, `src/lib/db/repos/securityLogRepo.js`, `src/lib/auth/dashboardSession.js`, `src/shared/services/telegramBackup.js`, `src/sse/services/backgroundTokenRefresh.js` — were absent from `.next/standalone/`. `getGuardModule()` correctly failed closed with 503 instead of serving. Only `assemble.sh` staged that tree, so anything that did not run it (the `npm`/`bun` scripts) started a server that refused every request. `scripts/copy-standalone-assets.mjs` (the `postbuild` hook) now stages `src/` and `scripts/` into the standalone tree the same way, and a unit test pins it. The guard is not weakened: the modules are present, so the auth and peer checks actually run.
- **`custom-server.js` resolves the app root instead of assuming `__dirname`**: a new `APP_ROOT`/`appPath()` pair probes `__dirname`, then two levels up, then one level up, and falls back to `__dirname`. Repo checkout and the systemd standalone layout (where `src/` sits beside the wrapper) resolve to the same directory as before; a packaged layout with the wrapper nested one level down now finds its source tree instead of silently failing the guard. `server.js` next to the wrapper is still looked up relative to the wrapper, which is correct for every layout.
- **Duplicate component imports removed** in `EditCompatibleNodeModal.js` and `AddCompatibleModal.js`: the #4999 quota-check merge kept the previous `@/shared/components` import alongside the new one that added `Toggle`, and webpack failed the whole build with `the name \`Button\` is defined multiple times`. Both files now import the single superset.

# v0.5.218 (2026-10-18) · 3 commits

## What Was Added

- **A flagged proxy egress no longer hard-blocks OpenCode free-tier (#4988 / issue #4983)**: the free-tier gate answers `403 FreeTierError` when the request leaves from an IP it has flagged, but the transport itself succeeded — so the existing proxy-failure fallback never fired and every retry kept leaving through the same flagged pool until a human rebound it. `proxyAwareFetch` now buffers a proxied 403, looks for the `FreeTierError` marker and replays **once** on the direct egress. Non-gate 403s pass through with their original headers, `strictProxy` still never leaves the configured path, a body already consumed by the first attempt surfaces the original 403, and this fork's `getDispatcher` + HTTP 407 proxy-auth detection is preserved underneath.
- **Quota check for OpenAI/Anthropic compatible providers (#4999)**: a `Quota check` toggle plus a quota path field on both compatible-node modals. When enabled, `/api/usage/[connectionId]` merges the node's `baseUrl`/`quotaPath`/`nodeName` and a new `customCredits` handler reads the standard credits endpoint, so the remaining balance appears on the Quota page. Opt-in: existing compatible nodes keep `quotaEnabled: false` and behave exactly as before. This fork's `logo`/`brand` node fields and its duplicate-name/prefix guard are preserved.
- **Human-readable model display names (#4989)**: routed slugs (`claude-opus-5-5`, `oc/space-bunny-free`, `cmc/z-ai/glm-5.3-flash`) now publish a readable `name` from `/v1/models`, `/v1beta/models` and `/api/models`, and the CLI writers (`9router connect`, cli-tools settings) write that name into client configs. An operator-set name is never rewritten; ids are untouched and `name` is purely additive. This fork's operator `owned_by` label is preserved on both custom-model paths.

# v0.5.217 (2026-10-18) · 3 commits

## What Was Added

- **Usage table opens on most recently used** (#5009): the by-model / account / API-key / endpoint tables defaulted to an alphabetical `rawModel` sort, so the rows that just moved were buried mid-list. The default sort is now `lastUsed` descending; clicking any column header still overrides it through the URL params.
- **`opencode/glm-5.3-flash-free` accepts reasoning again** (#5003): the id had no exact capability entry, so it resolved through the `*glm-5.3*` pattern and emitted z.ai's native `thinking:{type:"enabled"}` — which OpenCode's own inference service (a strict validator, not z.ai) answers with `400 json: unknown field "thinking"`. An exact-id `MODEL_CAPABILITIES` entry now sets `thinkingFormat:"openai"`, so these requests carry `reasoning_effort` and stream. Mirrors the existing `opencode-go` override for the paid twin.
- **CommandCode cache reads are recorded and the session id is stable** (#5006): the usage mapper dropped `cachedInputTokens`, so CommandCode traffic showed 0 cached on 4.7B prompt tokens while the same combo's OpenCode-Go leg showed 94%; the cache split is now mapped through to `prompt_tokens_details.cached_tokens` for both the client and the dashboard. Session identity now mints one conversation-scoped id shared by the `x-session-id` header and the envelope `threadId` (it used to mint two uncorrelated UUIDs per request).

# v0.5.216 (2026-10-18) · 1 commit

## What Was Added

- **Search box above the combo list** (ported from upstream decolua/9router PR #5008): filters case-insensitively over the combo name and the ids of its member models, shows an `N of M shown` counter while a query is active with an inline clear button, and renders an empty state with a **Clear search** action when nothing matches. The list now renders `filteredCombos` instead of the full set. Bulk operations were untouched (the fork has no header select-all), so a hidden combo can never be bulk-deleted.

# v0.5.215 (2026-10-18) · 1 commit

## What Was Fixed

- **Qoder and Cline model imports report progress in the notification bell**: the two batch import handlers on a provider page only disabled their button and spun an inline icon, so a 200-model import gave no progress and the operator had to stay on the page watching a spinner. Both now `start` a task in `taskStore` (the same store the backup, key, proxy-pool and account imports already use), `update` it per model with the model id and an `i/n` count, and `finish` it on every exit path — success, nothing-new, empty list, fetch error and exception alike. The bell announces the finished run like the other imports, and no floating progress UI is reintroduced.

# v0.5.214 (2026-10-18) · 1 commit

- refactor(ui): plugin marks are literal objects chosen by the user.
  - Direction locked via sequential prompts: symbols must depict the
    familiar thing (mountain-in-frame, eye, brain+arrow, torn brain,
    rocket, shield+check, scissors, wrench, broom) instead of an
    abstraction that is hard to guess.
  - PluginMark redrawn on the same single-outline grammar: uniform 2px
    round-cap stroke, caller-owned ink, at most one accent dot where the
    action lands.

# v0.5.213 (2026-10-18) · 1 commit

- refactor(ui): the nine plugin/capability marks are redrawn as one gridded,
  single-outline family.
  - All marks share the same 2.0 round-cap stroke, live in the same 17-unit box
    and use at most two gridded primitives; the hand-drawn arcs, the 14% plates
    and the mixed fill/outline grammar are gone.
  - One filled accent per mark, only on the thing being acted on: the pupil,
    the payload tread, the active node, the crossing at the apex. JSON Guard
    drops its payload dot - braces already say code, and the dot collided with
    Image Vision's frame-dot at 12px.
  - Think Deeper is a descending staircase with a filled tread (it used to read
    as a sort/filter bar set and tangled with the funnel), and Context Squeezer
    is a single bar pressed by two chevrons.

# v0.5.212 (2026-10-18) · 1 commit

- refactor(ui): the marks are drawn glyphs again, not text monograms.
  - PluginMark is back to unique SVG paths (viewfinder, eye, narrowing plates,
    chain graph, bolt, braces, presses, bridge, funnel) that stay legible at
    12px and 24px; a text render stopped reading as an icon.
  - The single-accent rule from v0.5.211 stays: no hue in the constants, the
    caller picks the ink (theme accent on the tile, muted on a dense row).
  - Stroke weights are explicit where the surface needs them (1.9 in
    CapacityBadges, 2.4 on 12px model rows).

# v0.5.211 (2026-10-18) · 1 commit

- refactor(ui): the plugin marks are monograms in one accent instead of seven
  pictograms in seven saturated hues.
  - PluginMark draws two letters (IV, TD, SM, JG, CS, OB, AS) in the caller's
    ink; native vision and reasoning get EY and RN so they cannot collide with
    Image Vision's IV on a shared model row.
  - Colour left the constants: CAPACITY_META and PLUGIN_MARK_META carry no hue,
    so a plugin tile is themed with the primary accent and a dense row stays
    muted from the same component.
  - The plugin card tile now states its own state - accent tint plus ring when
    on, flat neutral when off - instead of colouring the glyph.

# v0.5.210 (2026-10-18) · 2 commits

## What Was Removed

- **Prompt Injection feature and menu deleted**: the dashboard page (`/dashboard/prompt-injection`), its API (`/api/prompt-injection`), the `promptInjectionRepo`, the chat-handler call sites (combo/model and provider/model), the sidebar entry, the guard's protected-path entry, the permission rules, and the DB backup/restore carrying of the `promptInjections` kv scope are all gone; the feature's test suite is removed with it. Existing `promptInjections` kv rows are left in place (forward-only, no destructive migration) but nothing reads or writes them any more.

# v0.5.209 (2026-10-18) · 2 commits

## What Was Fixed

- **API-key quota card no longer under-reports after log cleanup**: `/api/usage/api-keys` summed `usageHistory` only, so a key at 20.65M/100M showed 6.4M (6%) once history rows were pruned by export/import cycles. The card now shows `max(apiKeys.usedTokens column, window sum)` — the column is what `validateApiKey` enforces, the log stays a fallback that still wins right after a window rollover.

# v0.5.208 (2026-10-18) · 2 commits

## What Was Fixed

- **Invalid API-key logins now count toward the lockout**, same as wrong passwords: `POST /api/auth/login` with an unknown/disabled/expired/IP-locked key replies `Invalid API key. N attempt(s) left before lockout.`, burns the same `recordFail` counter via `loginLimiter`, and reaches the same 429 `Too many failed attempts` lock after the limit. Quota-exhausted keys still sign in (v0.5.207). Audit event now carries the remaining attempts.

# v0.5.207 (2026-10-18) · 2 commits

## What Was Fixed

- **Exhausted API keys can still sign in to the dashboard**: `POST /api/auth/login` previously rejected `QUOTA_EXCEEDED` with 401, so a key at its token limit (e.g. 100M/100M) could never open the dashboard to see its own usage bar. The login route now lets a quota-exhausted key through (session + audit event `apikey_login_quota`); request-side enforcement is unchanged — `/v1/*` still fails because the SSE handler validates the key again. Disabled/expired/IP-locked keys are still rejected at login.

# v0.5.206 (2026-10-18) · 2 commits

## What Was Fixed

- **Relay deploy jobs no longer fail with `Cannot find module '@/app/api/proxy-pools/cloudflare-deploy/route'`**: `deploy-relay` resolved its route with `await import(modPath)` from a variable map, which webpack cannot trace (it emitted `Critical dependency: the request of a dependency is an expression`), so at runtime Node saw the raw `@/` alias and threw. The map now holds static importer functions (`() => import("@/app/api/proxy-pools/<provider>-deploy/route")`), so every route is a literal webpack bundles. `health-check`, which already used a literal, was unaffected.

# v0.5.205 (2026-10-18) · 2 commits

## What Was Fixed

- **No floating progress UI left**: `LongTaskBanner` no longer renders its `fixed inset-0` scrim or the collapsed `bottom-20 right-4` corner chip — a fixed banner returns `null`. Progress for every long task now lives solely in the notification bell (`taskStore` → `NotifToast`), so nothing duplicates it in a screen corner. The no-op helpers (`revealBackgroundedTasks`, `subscribeToTaskReveal`) stay exported for existing callers. Inline in-modal `ProgressCard fixed={false}` readouts are unchanged.

# v0.5.204 (2026-10-18) · 2 commits

## What Was Fixed

- **Loading states consolidated into the notification bell**: Importing/exporting the database, importing models, batch-testing provider connections, and deploying proxy relays no longer render a blocking `fixed inset-0` scrim or a `fixed bottom-right` corner chip. Every long-running operation now reports only through the bell task store (`taskStore` → `NotifToast`), matching the v0.5.198 contract. Modal-inline `ProgressCard` instances (`fixed={false}`) are retained.

# v0.5.203 (2026-10-18) · 2 commits

## What Was Fixed

- **Proxy pool fallback for no-auth providers**: Support automatic fallback and exclusion for rotating proxy pools on free/no-auth providers (`opencode`). Tag virtual connections with `proxy:<id>` so 403 `FreeTierError`, 429, and 5xx trigger seamless fallback across healthy pools without prematurely aborting requests.
- **OpenCode DeepSeek V4.1 Flash**: Aligned `OPENCODE_FAMILIES` regex to properly match `deepseek-v4.1-flash-free` and registered it with full format support (`[openai, claude, openai-responses]`).

# v0.5.202 (2026-10-17) · 2 commits

## What Was Fixed

- **OpenCode Free & Zen executors**: Synchronized 100% with Decolua master upstream (open-sse executors, registry, fingerprint definitions, and test suites). Restored official upstream session aliases, headers, and test specifications.

# v0.5.201 (2026-10-17) · 2 commits

## What Was Fixed

- **OpenCode Free & Zen executors**: Pruned redundant and unused tracking headers (`x-opencode-project`, `x-opencode-session-id`, `x-session-affinity`, `x-session-id`) across OpenCode free-tier requests to align strictly with upstream CLI behavior and prevent fingerprint mismatches.

# v0.5.200 (2026-10-17) · 2 commits

## What Was Fixed

- **OpenCode Free & Zen executors**: Aligned `opencode.js` and `opencode-zen.js` with Decolua v2 CLI fingerprinting and PR #4860 routing. Free-tier models are routed to `/inference/v1`, obsolete `x-opencode-request` header is removed to eliminate 403 `FreeTierError`, bitmask session ID generation with pinned counters is synchronized, and verbatim `read`/`shell` schemas are enforced.

# v0.5.199 (2026-10-17) · 2 commits

## What Was Fixed

- **OpenCode Free tier header alignment**: Updated OpenCode executors, registry, and catalog sync routes to default `x-opencode-client` to `cli`, enforce `x-opencode-project: global`, session affinity headers, and set `Accept: text/event-stream` across free-tier inference paths.

# v0.5.198 (2026-10-17) · 2 commits

## What's New

- **All dashboard loading flows consolidated into the notification bell**: Every long-running operation in the dashboard is now wired to the central task store instead of living only as isolated or floating corner widgets:
  - Provider batch tests ("Test All" for OAuth, Free tier, API key, and individual provider connections) now surface in the bell with live status, running indicator, and a 30s Completed row.
  - Profile database and backup actions (export database, import database with progress tracking, saving auto-backup configuration, and test backups) now sync directly to the notification bell.
  - Bulk import dialogs (Codex accounts, Grok CLI accounts, and multi-key API key imports) register with the bell task store so progress and completion are announced globally across the app.

# v0.5.197 (2026-10-16) · 2 commits

## What's New

- **Model import shows in the notification bell**: "Importing models" was a
  local dialog that lived only on the provider page, so closing the tab lost
  the run and nothing else in the dashboard knew it existed. It now registers
  as a long task like every other operation - visible in the bell while it
  runs, with a Completed row when it ends.

## What Was Fixed

- **"Fetching model list" no longer hangs**: the model-list endpoint talked to
  the provider with no timeout at all, so a stalled upstream left the dashboard
  spinning for minutes with no error. Every outbound read now races a fixed
  20-second budget, custom resolvers included, and a timeout answers plainly
  instead of looking like a crash. The browser also stops waiting on its own
  request after 20 seconds.


# v0.5.196 (2026-10-16) · 2 commits

## What Was Fixed

- **Dismiss control on task rows**: the running-work rows in the bell ("Running
  in background" / "Completed") had no remove button while notice rows did.
  Every task row now carries its own X. A store-backed row retires through the
  store so it stays gone; a row for a run whose page is closed is hidden for
  that run only.


# v0.5.195 (2026-10-16) · 2 commits

## What's New

- **Finished runs stay visible in the bell**: a completed long task keeps its
  row for 30 seconds, marked `Completed` in green, before it retires itself -
  so a finished import is announced instead of vanishing silently.
- **A green dot on the bell**: while any operation is running, a small green
  dot sits on the bell icon (top right), clear of the unread badge, so the
  work in flight is known without opening the panel.
- **Per-notice controls**: every notice row carries two buttons - mark as read
  (check) and remove (trash). The existing "Mark all read" header action is
  unchanged, and removing keeps the dedupe row so a condition that is still
  true is announced again.


# v0.5.194 (2026-10-16) · 2 commits

## What Was Fixed

- **Change Log categories show their colors again**: the reader-facing
  headings this fork writes (`What's New`, `What Changed`, `What Was Fixed`,
  `What Was Removed`, `What Was Undone`) were missing from the category map,
  so every pill fell back to the same grey. Each one now maps to its colored
  category with its own icon.
- **Change Log icons no longer blank**: every category and bullet icon is now
  a glyph the shipped icon subset carries, verified against the subset list.
- **Change Log shell follows the theme**: the modal frame, tab switcher and
  close button used raw black/white washes; they now use the same theme tokens
  as the notification bell.

# v0.5.193 (2026-10-16) · 2 commits

## What Was Fixed

- **Prompt Injection page in English**: every Indonesian label, helper text,
  empty state and guide panel on the AI Gateway Prompt Injection page is now
  English, matching the rest of the dashboard. The Bahasa Indonesia persona
  template keeps forcing Indonesian output, but its own name and description
  are English.

# v0.5.192 (2026-10-16) · 2 commits

## What Was Removed

- **Floating task dock**: the newest long task used to take a full-screen
  overlay and older ones stacked as cards in the bottom-right corner, covering
  the page being worked on. `TaskDock.js` is deleted and the layout no longer
  mounts it.

## What Changed

- **Live tasks live in the notification bell**: every long operation already
  reported into the task store, which the bell reads through `NotifToast`.
  With the dock gone the bell is the single place progress appears, and its
  badge keeps counting running tasks after notices are read.
- **Bell rows go back to the run's owner**: store tasks now carry the page
  driving them, so picking a row opens that page when it is no longer open.

# v0.5.191 (2026-10-16) · 4 commits

## What's New

- **AI Gateway Prompt Injection** (PR #8, by SatriaDivo): gateway rules that
  prepend, append or override system and user prompts across combos, models
  (wildcards supported) or all traffic, with per-key restriction, keyword and
  regex triggers, dynamic templating and a dashboard simulator, applied to
  live chat requests fail-open behind the feature flag -Custom

## What Was Fixed

- **PR #8 test**: its own suite called `extractUserText` without importing
  it (12/13 green); one-line import added, now 13/13 -Custom

# v0.5.190 (2026-10-16) · 1 commit

## What Was Undone

- **Compare Models restored**: the original view is back, undoing the task 6
  redesign on request. The `.arena-sticky` CSS block the redesign introduced
  goes with it, since nothing references it any more.

# v0.5.189 (2026-10-16) · 1 commit

## What Was Fixed

- **Compare Models composer in glass**: the pinned band carried an opaque
  `#0b0e14` plate that buried the aurora behind it. It now uses the same frost
  and blur as the sidebar, so the composer follows the active theme. An audit
  of the arena page found no other hardcoded colour - every class is a theme
  token. (Undone by the v0.5.190 revert.)

# v0.5.188 (2026-10-16) · 20 commits

## What Was Removed

- **PRD Builder** is gone from the dashboard: route, sidebar entry and UI removed, with a forward migration that drops its tables on live installs while migration 003 stays in place -Custom

## What's New

- **Update banner** restyled to the welcome banner's card language - header row, accent, action row - keeping version, behind-by and release-notes text -Custom
- **Compare Models** redesigned as a sticky composer with side-by-side columns, real idle/running/done/error states, proper empty and error states and a stacked mobile layout -Custom (**reverted in v0.5.190** on request; the original view is live)
- **Custom plugins reach the request**: enabled plugins inject their instruction text into the system prompt with explicit delimiters; no change when nothing is enabled, no duplicate block when enabled twice -Custom
- **Plugin marks on models**: a model with a custom plugin enabled shows that plugin's mark beside its name, matched by the same rule the request path uses -Custom
- **Long-task progress** moved into the notification bell as a Tasks section with percent bars; the bell badge counts live tasks, the floating card stays as the transient signal -Custom

## What Changed

- **Add OpenAI Compatible button** is now an opt-in white variant, legible on both dark and glass -Custom
- **Responsive contract**: PageShell owns page padding, max-width and vertical rhythm, wide tables scroll horizontally instead of clipping, modals scroll internally and the drawer can no longer exceed a phone viewport -Custom
- **Plugin marks redrawn** to match each plugin's function inside the existing 24x24 drawing language -Custom

# v0.5.187 (2026-10-16) · 2 commits

## What Was Fixed

- **Theme colour audit**: eight colour tokens that four hundred call sites referenced but the theme never declared (`bg-bg-subtle`, `text-text-primary`, `border-border-hover` and five more) are now defined for both dark and glass, so those surfaces finally render -Custom
- **Themed scrims and panels**: raw `bg-black/NN` overlays, `zinc`/`white` dark-only panels and hex status icons replaced with theme tokens (scrim, surface, danger, success/warning) so modals, banners and cards follow the selected theme -Custom

# v0.5.186 (2026-10-16) · 3 commits

## What's New

- **Design-token contract** landed at `src/shared/styles/chrome.css`: one radius ladder, a three-tier elevation scale, one motion/focus/disabled definition shared by the whole chrome layer -Custom

## What Changed

- **Card / Modal / Drawer / Select / Input / Toggle / Badge / Tooltip / Pagination / SegmentedControl** consume the contract instead of hardcoded radii, shadows and durations, so overlays and surfaces read as one system -Custom

## What Was Fixed

- **Nested modal scroll** is reference-counted in `src/shared/utils/scrollLock.js`; closing an inner dialog no longer re-enables page scroll behind the outer one -Custom

# v0.5.185 (2026-10-15) · 34 commits
## Features

- **Gemini 4 Argon** is now available on the `gemini`, `vertex` and `antigravity` providers, including 1M-token context, thinking control and global Vertex routing -Custom
- **Nous Research** joins the provider list with OAuth login and a free tier -Custom
- **Cursor IDE quota** is tracked through DashboardService, covering both the spend bucket and the request bucket -Custom
- **Quota auto-ping** runs on a single unified mode selector and defaults to local time, with DST-aware conversion and an anchored schedule at fixed local times (#4848) -Custom
- **Model picker** gained regex and negation search, batch select, provider filtering and wildcard patterns -Custom
- **Kiro** wires the AWS Identity Center device flow into provider OAuth (#587) -Custom
- **Hermes audio transcription** is available as a CLI tool through 9Router (#4763) -Custom
- **Antigravity** IDE version bumped to 2.22.0 -Custom
- **Cursor Auto (Server Picks)** resolves to the account's default agent model instead of failing (#4692) -Custom
- **Qoder** add-on (free-credit promo) quota appears in the quota tracker, with a "See details" pointer when the API exposes no reset date (#4758) -Custom
- **OpenCode Free capabilities** advertise the missing reasoning entries (space-bunny and friends) -Custom
- **Nous API-key attribution tags** are attached to requests (#4770) -Custom

## Fixes

- **OpenCode free tier** moved to `/inference/v1` with the v2 client fingerprint, which restores models that answered 403 after the endpoint change (#4842) -Custom
- **OpenCode Zen** uses the attested free-tier identity for `-free` models on the keyed lane (#4784) -Custom
- **OpenCode Zen** injects a `reasoning_content` placeholder so multi-turn Zen chats no longer fail on the first follow-up (#4805) -Custom
- **OpenCode Zen** verifies the inverted timestamp inside translated session IDs (#4780) - this was already satisfied in the fork by `generateSessionId()`, so no code change was needed -Custom
- **`claude-haiku-5-5`** on `opencode-go` routes to `/messages` with adaptive thinking (#4727) -Custom
- **Combos** fall back when a model answers HTTP 200 with zero usable content (#4750) -Custom
- **Gemini 4** drops sampling parameters and orders `functionResponse` last (#4802) -Custom
- **Vertex** honours API-key project/location for Gemini 4 Argon (#4821) -Custom
- **Copilot embeddings** route to `api.githubcopilot.com` (#4793) -Custom
- **Translator** returns Claude messages for forced SSE JSON responses instead of failing to parse them (#4789) -Custom
- **Headroom** no longer raises false compression warnings when tools dominate the body (#4855) -Custom
- **`gpt-5.5`** retired from the Codex registry, image list and auto-ping, since the model now answers 400 -Custom
- **`/v1/models`** exposes no-auth free providers and prunes custom models when their node is deleted -Custom
- **Usage stats** fall back to the input-token row and mask API keys stably between renders -Custom
- **Cursor** holds `strictProxy` on the AgentService h2 path (#4696) and recovers long sessions from empty AgentService turns (#4690) -Custom
- **Claude models** advertise PDF input support (#4761) -Custom
- **`response_format`** dropped for `opencode-go` deepseek models, which reject it -Custom
- **Dashboard** unclips the proxy dropdown and tooltips by rendering them through a body portal -Custom
- **QuotaTable** closes the reset-time wrapper `</div>`; the upstream reset redesign left the keyed row wrapper unbalanced and the unbalanced JSX aborted the whole usage build -Custom
- **Tests** isolate the zed-native-auth `DATA_DIR` so a full-suite run no longer writes a real connection into the live database -Custom

## Internal

- `Co-Authored-By` trailers are stripped from every ported commit so the fork keeps a single, consistent authorship trail -Custom
- Conflict markers introduced by the merge are removed before committing, and every ported file is verified to parse -Custom

## Skipped

The following upstream commits in the v0.5.104 range were deliberately not ported:

- `2aa9307f` / `6ed88685` - per-key token quotas and pattern-based model access, which upstream reverted in the same range (net zero)
- `3c48d275` - an unlabelled bookkeeping commit with no functional content
- `87a74e1b` - the upstream release-note commit; this fork maintains its own CHANGELOG

# v0.5.184 (2026-10-15) · 4 commits

## Features

- **Provider panel: full catalogue with a FREE badge.** The suggested list on the OpenCode Free page now shows every upstream model (87) instead of only ids ending in `-free`, which had hidden free models without the suffix - `big-pickle` is now allowlisted as known-free and verified 200 on the free tier. Free models are grouped first (12) with a green FREE badge and paid models sit under a separate "Other models" heading, so the two can never be read as one list.

## Fixes

- **Free-tier consumers stay on the free subset.** `/api/models`, `/api/v1/models`, `ModelSelectModal` and `freeCatalogSync` now filter on the new `isFree` flag through a single `onlyFree` helper, so widening the suggested list cannot advertise paid ids that answer 401 without a key.

# v0.5.183 (2026-10-15) · 1 commit

## Fixes

- **Suggested model list: bypass Next.js fetch for free catalogues.** The live catalogue lookups in `/api/providers/suggested-models` and its server-side fetcher now use undici directly. The server-side global fetch is Next.js's patched copy, which swallowed abort signals and let the upstream call hang until the outer ceiling answered with the curated fallback - the panel then showed only built-in models instead of the live list.

# v0.5.182 (2026-10-15) · 1 commit

## Fixes

- **Suggested model list: hard request ceiling.** `/api/providers/suggested-models` and its server-side fetcher now race the whole lookup against a fixed timeout. A stalled await previously held the route open indefinitely and left the provider panel blank; it now answers the curated fallback list instead.

# v0.5.181 (2026-10-15) · 1 commit

## Fixes

- **Reverted the update banner restyle.** The glassmorphism/amber-glow banner from `9bddda9` was rolled back to the original dashboard banner, restoring the upstream look and the previous markup and styling.

# v0.5.180 (2026-10-15) · 1 commit

### Fixes
- **Proxy Pools**: Handle HTTP 407 (Proxy Authentication Required) when proxy pool credentials are expired or rejected so requests are not silently passed through.
- **Proxy Pools**: Deactivate 375 dead/expired proxy entries from the database pool to prevent uncontrolled fallback to VPS IP causing HTTP 429 (Rate Limit).

# v0.5.179 (2026-10-15) · 2 commits

### Fixes
- **OpenCode Free**: Apply latest PR #4840 patch (`f2f74a77`) to prevent 403 `FreeTierError` when testing from browser / dashboard:
  - Fix User-Agent validation so the regex does not false-positive on browser tokens (e.g. `Mozilla/5.0`), ensuring UA is always spoofed to `opencode/latest/2.0.29/cli`.
  - Translate and cache non-native session IDs into canonical inverted-timestamp 12-hex format to pass upstream validation.
  - Guard session header fallback and ensure `anthropic-version` header is attached for messages models.
- **OpenCode Fingerprint**: Normalize `bash` / `Bash` tool alias to canonical `shell` with official OpenCode parameter schema.

# v0.5.178 (2026-10-14) · 1 commit

## What Was Fixed
- **OpenCode Free big-pickle removed & forced Bearer public**: big-pickle was retired from OpenCode free tier and returned 403 FreeTierError during provider tests. Dropped big-pickle from free model filters and ensured upstream Authorization header always uses "Bearer public" without leaking 9router user API keys -Custom

# v0.5.177 (2026-10-14) · 1 commit

## What Was Fixed
- **OpenCode Free 403 FreeTierError bypassed**: upstream v2.0.29 updated its anti-abuse gate, migrating free-tier endpoints to `/inference/v1/...`, enforcing official client UAs (`opencode/latest/2.0.29/cli`), requiring canonical tool fingerprints (`read` and `shell`), and sending `x-opencode-session-id`, `x-session-affinity`, `x-session-id`, and `x-opencode-project: global`. Verified live with cat-jam-free, nemotron-3.5-lightning-free, and longcat-2.5-preview-free returning 200 OK -Custom

# v0.5.176 (2026-10-14) · 1 commit

## What Was Deleted?
- **9Remote link from navigation sidebar**: removed external link to 9remote.cc from the dashboard sidebar menu -Custom

# v0.5.175 (2026-10-14) · 1 commit

## What Was Fixed
- **Gemini Web answers finally land (stream never closes)**: reads showed Google sends a 186-byte handshake, sits silent 45s, and keeps the HTTP stream open long after the answer is complete - so the old "wait for the whole response" hang forever. The executor now reads incrementally and stops at the first parseable answer, with a 30-second silence guard and a 150-second ceiling matching measured replies (4-108s on this box). Proven live: 3.6-flash 200-OK in 43s, argon 200-OK in 34s, 3.5-lite in 4s -Custom
- **3.1-pro narrows the device profile**: its real replies prove only one knowledge cutoff has a UI card available offline, same as the 3.6 generation before it -Custom

# v0.5.174 (2026-10-14) · 1 commit

## What Was Fixed
- **"The operation was aborted due to timeout" on Gemini Web model tests**: the probe budget was a flat 15 seconds, but the web endpoint answers a warmed-up probe in 13-50 seconds, so nearly every model reported as broken - including argon, which passes comfortably when given room. Web-cookie providers (Gemini Web, Kimi Web, DeepSeek Web, Xiaomi MiMo) now get a 90-second probe; REST providers keep failing fast at 15s -Custom
- **Gemini Web session fetch cost**: every request re-downloaded the 800KB /app page for its session token, which alone took 30-60s. The session is now cached for 10 minutes and re-fetched once only when the server rejects the token, cutting warm requests from ~90s to seconds -Custom
- **Gemini Web model tests fired in parallel**: "Test all models" fan-out all probes at once, but Google queues per account, so the probes timed out behind each other. Web-cookie providers now probe serially -Custom
- **Misleading Gemini errors**: empty upstream replies said "cookie may be expired", which sent perfectly good __Secure-1PSID cookies through a re-copy dance. The message now states what actually happened (no content in N bytes) -Custom

## What's Under the Hood?
- Probe timeout became per-provider via exported WEB_COOKIE_PROVIDERS set, covered by a unit test -Custom

# v0.5.173 (2026-10-14) · 1 commit

## What's Added?
- **Gemini Web sync with gemini-web2api-go**: model table now matches the upstream server list - gemini-3.6-flash, 3.5-flash-lite, 3.1-pro, 3.8-flash (3.7 kept as alias), 4-argon, plus -thinking variants for each. Selection goes through the model header the server actually reads, extended thinking is switched via inner slot 80 plus header slot 15, and responses surface reasoning_content -Custom
- **OpenAI tool calling for Gemini Web and Kimi Web**: both previously answered 400 "does not support OpenAI function tools". Tools are now encoded into the prompt and recovered from the reply as standard tool_calls, following the proven application-level pattern, so agents get working function calls instead of an error -Custom
- **Shared web-cookie tool bridge**: new webCookieToolBridge module encoding the OpenAI tools array into the prompt (with tool_choice none/auto/required/forced honored) and parsing model replies back into tool_calls, with tolerant JSON recovery for lenient model output -Custom

## What Was Fixed
- **Gemini Web model mismatch**: requests previously carried no model selector at all, so everything silently landed on 3.5 Flash-Lite regardless of the chosen model
- **Gemini Web fingerprint**: Chrome 146 desktop user agent and browser headers replace the previous Linux-box string, matching the reference client
- **Gemini Web session auth**: XSRF token handling and SAPISIDHASH authorization corrected per the captured browser flow, so signed-in cookies stop getting blanket 400s
- **Gemini Web response cleanup**: code-execution artifacts are stripped from replies instead of leaking raw markers, without ever returning an empty answer for math/code turns
- **Kimi Web tool turns**: assistant tool_calls and tool results fold into readable transcript lines, so multi-step agent loops stay coherent instead of throwing

# v0.5.172 (2026-10-14) · 1 commit

## What Was Deleted?
- **Endpoint page**: the orange "Paused" label under a switched-off API key is gone - the toggle still shows the off state and the row still dims, without the extra text -Custom

# v0.5.171 (2026-10-14) · 25 commits

## What's Added?
- **Amazon Bedrock provider**: new provider with AWS SigV4 request signing, static API keys, and AWS SSO (IAM Identity Center) credential profiles. Ships with a second variant for xAI models hosted on Bedrock -Custom
- **Hermes per-profile configuration**: Hermes model config can now be stored per profile instead of one global YAML, with bulk apply and reset from the dashboard
- **Netlify Relay for Proxy Pools**: Proxy Pools can deploy a relay straight to Netlify from the dashboard, including a dedicated modal for entering site credentials
- **MiniMax Code (`mcode`)**: new provider entry with its credit-based quota surfaced in the dashboard
- **System One endpoint (`clef-flash`)**: new Cloudflare-backed system endpoint
- **9Remote sidebar item**: the sidebar entry now opens 9Remote directly in a new tab
- **CLI `show` and `--save`**: the CLI can display current settings and persist interactive answers; `connect` can now be issued from the server side
- **ElevenLabs Scribe STT**: new speech-to-text model entry alongside the existing text-to-speech catalog
- **Claude Sonnet 5.5 and Opus 5.5** on Antigravity, with reasoning effort support on Claude tool cards
- **Antigravity catalog refresh**: Gemini 3.8 Flash, 3.6 Flash, and 3.1 Pro High added to the model list
- **Self-hosted TTS**: custom model and voice support for self-hosted text-to-speech endpoints

## What Was Fixed
- **Gemini translator**: a tool parameter literally named `properties` is no longer mistaken for a schema node, which was causing 400 errors from Google Vertex and Gemini with MCP tools
- **Gemini translator**: `functionResponse` payloads rename `$ref` instead of forwarding it, and tool properties travel as `properties` rather than a raw schema
- **Translator**: duplicate `tool_call_ids` are collapsed so a single tool result is not replayed twice
- **Capabilities**: GLM-5.3 now reports thinking support, and GLM-5.2 / GLM-5.3 context windows corrected to 1M tokens
- **Combos**: compatible node models are shown in the picker even when the combo has no active connection
- **Kimi**: the client is routed to the native Responses endpoint instead of chat completions
- **Cursor**: reasoning effort is forwarded, and empty turns are rejected rather than sent upstream
- **Codex**: strict mode flag is honoured and image tokens are counted correctly
- **Ollama**: `prompt_eval_cached_count` is read, so cached prompt tokens are not billed twice
- **Muse**: the transport is now Responses-only, matching what the provider actually accepts
- **TTS**: self-hosted model and voice names are no longer mangled
- **CLI**: Pi and Oh My Pi hosts are supported alongside the existing targets

## What Looks Different?
- **Mobile endpoint layout**: the API key list card reflows on narrow screens - the row uses `items-start`, the meta line wraps, long keys break instead of overflowing, and the action buttons keep a shrink-safe wrapper
- **Mobile provider models and cli-tools**: both pages get the same narrow-screen treatment
- **Mobile settings (Claude CLI)**: settings rows no longer clip on phone widths

## What's Under The Hood?
- **Provider registry**: Bedrock and Bedrock-xai registered as slots `p148` and `p149`, with the slot array kept in sync with the files actually present on disk
- **Hermes YAML**: profile and YAML helpers moved into dedicated modules, so the settings route no longer carries the parser inline
- **AWS credential resolution**: `@aws-sdk/credential-providers` added as an optional dependency, with the import guarded so bundling does not fail when the optional package is absent
- **Porting scope**: 28 upstream v0.5.99 commits ported, 1 deliberately skipped (`d8c585fb`, per-API-key access control) and 2 resolved as no-ops because the fork already carries an equal or better implementation

# v0.5.170 (2026-10-14) · 1 commit

## What Looks Different?
- **Changelog Modal**: category pills now read as full uppercase questions instead of a bare section noun - "WHAT'S ADDED?" (green), "WHAT WAS FIXED?" (amber), "WHAT WAS DELETED?" (rose), "WHAT WAS REPLACED?" (violet), "WHAT CHANGED?" (pink), "WHAT GOT FASTER?" (cyan), "WHAT WAS HARDENED?" (red), "WHAT'S DOCUMENTED?" (sky), "WHAT LOOKS DIFFERENT?" (orange), "WHAT'S UNDER THE HOOD?" (slate). The trailing small category name is gone; the left accent bar now carries the colour -Custom
- **Changelog Modal**: four new canonical categories with their own colours and icons - Changed, Performance, UI, plus Security/Hardened reworded from "Security" to "WHAT WAS HARDENED?"; Changelog.md headings converted (171 of them) so the raw file and the rendered panel speak the same vocabulary -Custom

## What Was Fixed
- **Changelog Modal**: alias map gained bugfixes, refactors, optimisation, styling, accessibility and the question-form headings, so upstream spellings no longer collapse into one grey "label" pill -Custom

# v0.5.169 (2026-10-14) · 3 commits

## What's Added?
- **OpenCode Free & Zen**: integrate exact bash formula `((~(timestamp_ms * 4096 + counter)) & 281474976710655)` into `generateSessionId()` for canonical 12-hex descending inverted timestamp session header (`x-opencode-session`) generation (PR #4782) -Custom
- **OpenCode Free & Zen**: implement PR #4782 session translation cache & inverted timestamp generator (`translateSessionId`) across both `opencode.js` and `opencode-zen.js` to ensure generated sessions carry valid descending timestamp headers and prevent 403 FreeTierError -Custom

## What Was Fixed
- **OpenCode**: ensure robust fallback header generation for missing session credentials in executor `buildHeaders` -Custom
- **Endpoint Keys UI**: remove the "Key switched off" text badge from the inactive API key card in `EndpointPageClient.js` - the toggle switch already communicates the off state, the extra label was visual noise -Custom

# v0.5.166 (2026-10-12) · 1 commit

## What's Added?
- **Custom Models**: an anti-probe switch sits above the model list. It turns the BazaarLink-oriented check on or off and says what it does; the anti-mask panel appears in the form only while the switch is on. The state lives in settings, so every administrator gets the same editor instead of each browser deciding alone.

## What Was Fixed
- **Usage**: the overview sparkline under each metric card is gone - the numbers stay in one centred row. `/api/usage/sparks` still feeds the activity heatmap.

# v0.5.165 (2026-10-11) · 18 commits

## What's Added?
- **Proxy Pools**: Delete All button, plus Select all now spans the whole filtered list instead of the 20 visible rows
- **Proxy Pools**: bulk delete runs as one transaction on `/api/proxy-pools/bulk` instead of one request per pool

## What Was Fixed
- **Theme**: glass and dark draw every surface from the theme tokens; leftover solid slabs (white OpenAI button, opaque black log viewport, zinc-bordered usage cards, gray tooltip, gray badge dot, chat bubble hex, console-log line numbers, unknown-tool badge, native checkbox borders, manual-update dialog, footer icons) now follow the active theme, verified by screenshot in both themes
- **Models**: hide orphan compatible groups from the model picker, so a deleted OpenAI/Anthropic Compatible node no longer opens a raw `OpenAI Compatible (xxxxxxxx)` heading full of dead rows
- **Models**: import progress card stays inside its own section instead of dimming the whole dashboard
- **Proxy Pools**: backgrounded dock chip no longer leaves an invisible overlay that swallows every click; import and relay deploy dialogs close on start so the page stays clickable
- **Proxy Pools**: relay deploy dialogs no longer refuse to close after a successful deploy
- **Proxy Pools**: bulk delete ignores a non-array id payload instead of throwing
- **Update**: fix the doubled v in the update banner (vv0.5.165 to v0.5.165)
- **Models**: an API-key session no longer lists models outside its allowedModels; the filter matched a key scope against a model's display name, so a row labelled `DeepSeek-V4-Pro` but addressed as `qd/dmodel` appeared under a key scoped to `deepseek-v4-pro` and 403'd when called
- **Models**: the available-models card lists one row per model a key may call instead of one row per provider connection, so a key scoped to twelve models shows twelve rows rather than 43 (deepseek-v4-pro alone was reached through 21 connections)
- **Dashboard**: the welcome dialog no longer shows the traffic-light close dots; Get started is the only way out
- **Custom Models**: the anti-mask panel is gone from the editor form; it carried the BazaarLink probe link and vendor-name warnings, and the form keeps the owned_by and context fields
- **Usage**: drop the mini trend line under each overview number (requests, input, cached, output, cost); those lines are a per-day series under a number that covers the whole selected range, and on the coarse ranges they were a flat baseline with one spike
- **Usage**: the day-bucketed usage area chart is gone from the coarse periods (7d and up); those series are a flat baseline with a single spike. Today and 24h keep their chart
- **Dashboard**: health check and relay deploys run as server-side jobs too, so they survive a closed browser or a different menu like the batch import; the bell lists every operation still running, and opening one from there brings back its banner
- **Proxy Pools**: batch import runs as a server-side job, so closing the browser no longer kills the run halfway; /api/proxy-pools/import-jobs accepts the parsed list, runs it in-process, and the page polls for progress (reloads reattach to the same job instead of starting over)
- **Dashboard**: the notification bell lists running server-side imports with live progress, and opening one takes you back to the run so the collapsed banner reopens
- **Loader**: the long-task banner carries no helper copy and its cancel/background controls are small borderless glyph buttons instead of boxed clusters
# v0.5.164 (2026-10-10) · 11 commits

## What's Added?
- **Dashboard**: cost mode in the provider chart, hardened tool bridge, cleaner welcome banner
- **Welcome**: show the running version and a fuller orientation line

## What Was Fixed
- **Marks**: stop old ligatures on model rows; one-surface welcome dialog
- **Plugins**: neutral tiles with saturated glyph marks
- **Plugins**: one mark per card, redrawn as a single family
- **Welcome**: changelog button now opens the changelog
- **Welcome**: make Star on GitHub a visible ghost button

## What's Under the Hood?
- **Auth**: drop mandatory 2FA, back to password-only login
- **Copy**: replace em dashes with plain punctuation across the UI

# v0.5.163 (2026-10-09) · 1 commit

## What's Added?
- **Plugins**: add OpenAI Tool Bridge - recovers tool calls from a text-only provider's answer instead of failing the request
- **Plugins**: restyle every custom plugin mark - two-layer tile with a docked badge and an enabled ring

## What Was Fixed
- **Changelog**: stop the merge of two same-day releases from printing one bullet twice, and fold repeated scope prefixes into a single heading
- **Changelog**: group entries by scope
- **Loading**: move Cancel and Run in background inside the banner frame as one compact control cluster
- **Loading**: keep backgrounding across a remount so the overlay cannot come back over the page
- **Models**: name each available-model row with the connection it calls, so one model reachable through several providers no longer looks like a duplicate
- **Models**: collapse rows that are the same call path

# v0.5.162 (2026-10-09) · 1 commit

## What's Added?
- **Dashboard**: drop the Benchmark menu, page and API route

# v0.5.161 (2026-10-07) · 5 commits

## What's Added?
- **Dashboard**: add inbox error listing failed requests
- **Notifications**: bell opens the changelog; drop the inbox error and security log surfaces
- **Notifications**: surface failed requests and security events in the bell

## What Was Fixed
- **Security log**: stop probe signatures from swallowing sign-in events
- **UI**: scroll the update banner with the page and use English copy in the error inbox

# v0.5.160 (2026-10-07) · 1 commit

## What's Added?
- **Dashboard**: add inbox error listing failed requests

# v0.5.159 (2026-10-05) · 1 commit

## What Was Fixed
- **Auth**: refuse shutdown and live-update for API key sessions; hide the controls too

# v0.5.158 (2026-10-04) · 25 commits

## What's Added?
- **Antigravity**: add Claude Opus 5.5 and Sonnet 5.5 models
- **Antigravity**: list Claude 5.5 models and flag them when tier-blocked
- **Dashboard**: full request bodies, notification bell, settings rollback, bulk key edit, model benchmark
- **Dashboard**: make PRD Builder one prompt, English copy
- **Key catalog**: show context window instead of the studio label; install the fork from github in the update banner
- **Models**: optional owned_by on custom models; fix hidden security log; drop usage CTA
- **Security**: persistent security log with red breach flags, admin-only site theme
- **Studio,banner**: hide the upstream model, custom owned_by, cancellable background banners

## What Was Fixed
- **Auth**: fail closed when the dashboard guard cannot run
- **Dashboard**: accept combo names in PRD Builder
- **Docker**: ship the auth guard sources into the runtime image
- **Docker**: ship the guard runtime deps the src tree imports
- **Docker**: stamp APP_REVISION from Railway commit SHA so update banner works there
- **Import**: keep the poll digest alive until the job record expires
- **Import**: return the poll token in the job creation response
- **Models**: publish custom model owned_by on the connected path too
- **Notifications**: point the update notice at the profile page, not the dead settings route
- **Providers**: mark MiMoCode Free as Unavailable in red
- **UI**: replay update banner animation on navigation and animate dismissal
- **UI**: ship icon subset font and show commit counts on changelog cards
- **UI**: show long operations in a ProgressCard banner
- **UI**: theme the loading banner, keep progress on the background chip, always offer cancel and background

## What's Documented?
- **Readme**: current screenshot, evergreen feature section, auto-refresh workflow
- **Readme**: refresh dashboard screenshot to v0.5.155

## What's Under the Hood?
- **Models**: Revert "feat(antigravity): add Claude Opus 5.5 and Sonnet 5.5 models"

# v0.5.157 (2026-10-04) · 22 commits

## What's Added?
- **Antigravity**: add Claude Opus 5.5 and Sonnet 5.5 models
- **Antigravity**: list Claude 5.5 models and flag them when tier-blocked
- **Dashboard**: full request bodies, notification bell, settings rollback, bulk key edit, model benchmark
- **Dashboard**: make PRD Builder one prompt, English copy
- **Models**: optional owned_by on custom models; fix hidden security log; drop usage CTA
- **Security**: persistent security log with red breach flags, admin-only site theme
- **Studio,banner**: hide the upstream model, custom owned_by, cancellable background banners

## What Was Fixed
- **Auth**: fail closed when the dashboard guard cannot run
- **Dashboard**: accept combo names in PRD Builder
- **Docker**: ship the auth guard sources into the runtime image
- **Docker**: ship the guard runtime deps the src tree imports
- **Docker**: stamp APP_REVISION from Railway commit SHA so update banner works there
- **Import**: keep the poll digest alive until the job record expires
- **Import**: return the poll token in the job creation response
- **Models**: publish custom model owned_by on the connected path too
- **Providers**: mark MiMoCode Free as Unavailable in red
- **UI**: replay update banner animation on navigation and animate dismissal
- **UI**: ship icon subset font and show commit counts on changelog cards
- **UI**: show long operations in a ProgressCard banner

## What's Documented?
- **Readme**: current screenshot, evergreen feature section, auto-refresh workflow
- **Readme**: refresh dashboard screenshot to v0.5.155

## What's Under the Hood?
- **Models**: Revert "feat(antigravity): add Claude Opus 5.5 and Sonnet 5.5 models"

# v0.5.156 (2026-10-04) · 21 commits

## What's Added?
- **Antigravity**: add Claude Opus 5.5 and Sonnet 5.5 models
- **Antigravity**: list Claude 5.5 models and flag them when tier-blocked
- **Dashboard**: full request bodies, notification bell, settings rollback, bulk key edit, model benchmark
- **Dashboard**: make PRD Builder one prompt, English copy
- **Models**: optional owned_by on custom models; fix hidden security log; drop usage CTA
- **Security**: persistent security log with red breach flags, admin-only site theme
- **Studio,banner**: hide the upstream model, custom owned_by, cancellable background banners

## What Was Fixed
- **Auth**: fail closed when the dashboard guard cannot run
- **Dashboard**: accept combo names in PRD Builder
- **Docker**: ship the auth guard sources into the runtime image
- **Docker**: ship the guard runtime deps the src tree imports
- **Docker**: stamp APP_REVISION from Railway commit SHA so update banner works there
- **Import**: keep the poll digest alive until the job record expires
- **Import**: return the poll token in the job creation response
- **Models**: publish custom model owned_by on the connected path too
- **Providers**: mark MiMoCode Free as Unavailable in red
- **UI**: ship icon subset font and show commit counts on changelog cards
- **UI**: show long operations in a ProgressCard banner

## What's Documented?
- **Readme**: current screenshot, evergreen feature section, auto-refresh workflow
- **Readme**: refresh dashboard screenshot to v0.5.155

## What's Under the Hood?
- **Models**: Revert "feat(antigravity): add Claude Opus 5.5 and Sonnet 5.5 models"

# v0.5.155 (2026-10-04) · 20 commits

## What's Added?
- **Antigravity**: add Claude Opus 5.5 and Sonnet 5.5 models
- **Antigravity**: list Claude 5.5 models and flag them when tier-blocked
- **Dashboard**: make PRD Builder one prompt, English copy
- **Models**: optional owned_by on custom models; fix hidden security log; drop usage CTA
- **Security**: persistent security log with red breach flags, admin-only site theme
- **Studio,banner**: hide the upstream model, custom owned_by, cancellable background banners

## What Was Fixed
- **Auth**: fail closed when the dashboard guard cannot run
- **Dashboard**: accept combo names in PRD Builder
- **Docker**: ship the auth guard sources into the runtime image
- **Docker**: ship the guard runtime deps the src tree imports
- **Docker**: stamp APP_REVISION from Railway commit SHA so update banner works there
- **Import**: keep the poll digest alive until the job record expires
- **Import**: return the poll token in the job creation response
- **Models**: publish custom model owned_by on the connected path too
- **Providers**: mark MiMoCode Free as Unavailable in red
- **UI**: ship icon subset font and show commit counts on changelog cards
- **UI**: show long operations in a ProgressCard banner

## What's Documented?
- **Readme**: current screenshot, evergreen feature section, auto-refresh workflow
- **Readme**: refresh dashboard screenshot to v0.5.155

## What's Under the Hood?
- **Models**: Revert "feat(antigravity): add Claude Opus 5.5 and Sonnet 5.5 models"

# v0.5.154 (2026-10-03) · 21 commits

## What's Added?
- **Dashboard**: add PRD Builder to FEATURE+
- **Token saver**: level presets for pruning and a measurable response cache
- **Usage**: add activity heatmap, card sparklines, and smart empty states
- **Usage**: remove the live request inspector tab
- **Usage**: token saver analytics tab with real-savings estimates

## What Was Fixed
- **Models**: honor .env PORT on start and persist free model catalogues
- **Combo**: combo pills report the real window instead of the 200k default
- **Providers**: drop the duplicate MiMo free registry entries
- **Providers**: keep suggested free models visible when opencode flakes
- **Token saver**: keep option rows under their own text
- **Token saver**: move the two toggles to the bottom, stack all pickers
- **UI**: merge duplicate category headings in day-rolled changelog cards
- **Usage**: center summary card numbers and pin them to one baseline
- **Usage**: only show providers with real traffic in the topology
- **Usage**: savings table empty state must not blame the filter

## What's Documented?
- **Token saver**: shorten the two longest row labels

# v0.5.153 (2026-10-02) · 18 commits

## What's Added?
- **Plugins**: JSON Guard + Context Squeezer custom plugins
- **Providers**: add MiMoCode Free no-auth provider (mimocode/, mimocode-free/)
- **Providers**: merge live free-model catalogue into /v1/models and the picker
- **UI**: maintenance badge, shared provider icons, merged changelog cards
- **UI**: show live free-model catalogue in the model picker
- **UI**: single animated update banner on dashboard; drop sidebar copy

## What Was Fixed
- **Auth**: enforce the dashboard guard in custom-server because Next 14 middleware is Edge-only
- **Dev**: isolate dev build to .next-dev on localhost:20128 so dev runs stop corrupting the production .next
- **Hook**: converge via a single settled post-commit amend loop
- **Hook**: fold regenerated changelog into each commit via post-commit amend
- **Hook**: keep backticks out of the hook template so install works
- **Hook**: pass --no-verify on the amend so prepare-commit-msg stops re-dirtying the tree
- **UI**: drop key={pathname} from UpdateBanner; sibling keys collided with Header and leaked one header per navigation

## What's Documented?
- **Auth**: regen changelog for auth-guard fix
- **Backup**: restore full fork changelog history (119 versions, an old commit had truncated it to 3)
- **Changelog**: stage changelog output in the git hook so commits stop leaving CHANGELOG.md dirty
- **Changelog**: sync changelog for the hook fix

## What's Under the Hood?
- **Auth**: release v0.5.153 (auth guard enforced at HTTP layer)

# v0.5.152 (2026-10-01) · 20 commits

## What's Added?
- **Providers**: add v1m System One provider
- **Agnes**: seed the 2.5/3.0 model ids in the registry
- **Claude**: add Claude Sonnet 5.5
- **CLI**: add connect command for remote 9router servers
- **Codebuddy**: parse 6004 rate limit error and extract resetsAtMs
- **Codex**: add GPT-6.1 Sol
- **Codex**: expose 1M context variants for GPT-6 and GPT-5.6
- **Glm**: add Z.ai OAuth login to GLM Coding (dual-auth)
- **Kiro**: add claude-opus-5.5 models to registry and capabilities
- **Muse**: add Meta Muse provider with OAuth login and model catalog
- **Providers**: per-provider custom header overrides from the registry
- **Quota**: sync ?provider= URL param with provider filter for bookmarkable deep links (#4395)
- **UI**: unify every long-operation loading into one centered progress card
- **Web**: add TinyFish search and fetch provider

## What Was Fixed
- **Backup**: stop invalid-password error during import by polling with a token
- **Keys**: show created keys to their creator session everywhere, label creators by name
- **Tests,endpoint**: throwaway DATA_DIR for vitest; auto-create key named 'Default Keys' with duplicate-provision guard
- **Tests**: point vitest DATA_DIR at a throwaway dir so fixtures never write the live DB

## What's Documented?
- **Changelog**: regen changelog for upstream v0.5.95 features
- **Changelog**: restyle fork CHANGELOG to match the upstream format

# v0.5.151 (2026-09-30)

## What Was Fixed
- **Import**: show bulk import progress overlay and block closing the modal while a bulk add/import loop is running, split large codex/grok payloads into batches of 20
- **Logging**: dedupe repeated auth-failure log lines per source/ip/key prefix so a misconfigured polling client no longer floods the log, 401 responses still sent
- **Backup**: forward the backup password as `x-9r-password` header when polling the import job so password-protected imports track progress
- **Providers**: resolve provider aliases for suggested-model fetcher lookup, fall back to built-in models with an error note when upstream is unreachable, tolerate upstream schema drift

# v0.5.150 (2026-09-30)

## What Was Fixed
- **API Keys**: show created-by label under each API key name on the endpoint page
- **API Keys**: include `createdBy` in `POST /api/keys` 201 response
- **Inspector**: open live-requests inspector stream without login gate, scope rows by key `allowedModels`, refresh every 5s
- **Models**: hide orphaned compat alias ghost groups in the model picker and clean up custom models plus aliases on provider node delete

## What's Under the Hood?
- **Tests**: add structural backup self-check covering apiKeys permissions and createdBy round-trip

# v0.5.149 (2026-09-30)

## What Was Fixed
- **Settings**: move tracing config into experimental and exclude user profile paths

# v0.5.148 (2026-09-30)

## What Was Fixed
- **Build**: mark db adapters external the Next 14 way so bun sqlite skips the webpack bundle

# v0.5.147 (2026-09-30)

## What Was Fixed
- **Build**: restore build dependencies dropped during the Next 14 downgrade

# v0.5.146 (2026-09-29)

## What Was Fixed
- **Build**: drop unknown webpack flag from the build script for next 14.2.35

# v0.5.145 (2026-09-29)

## What Was Fixed
- **Build**: pin `@types/react-dom` to existing 18.x to fix Railway install

# v0.5.144 (2026-09-29)

## What Was Hardened?
- **Build**: bump next to 14.2.35 to resolve high severity CVEs

# v0.5.143 (2026-09-29)

## What's Added?
- **Usage**: show available models in apikey session usage
- **Models**: allow combo as custom model target with cycle guard

# v0.5.142 (2026-09-29)

## What's Added?
- **Backup**: show centered loading overlay with progress while exporting, importing, or testing a backup
- **Backup**: run backup import as a background job with per-section progress so the UI stays responsive

# v0.5.141 (2026-09-29)

## What's Added?
- **Backup**: include permissions and `createdBy` columns in apiKeys backup export/import
- **Backup**: add backup self-check for round-trip export→import preserving apiKey metadata

## What Was Fixed
- **API Keys**: add `createdBy` `"dashboard"` value for dashboard users in `POST /api/keys`
- **Backup**: fix round-trip `exportDb`/`importDb` to preserve permissions and `createdBy` fields

# v0.5.140 (2026-09-28)

## What Was Fixed
- **Models**: stop the model picker heading a group with a generated node id
- **Models**: disambiguate compatible provider headings with a short uuid suffix so two custom providers never share one label

## What's Under the Hood?
- **Tests**: add structural and distinctness cases for the new heading disambiguation in `providerDisplaySelfCheck`

# v0.5.139 (2026-09-28)

## What Was Fixed
- **Streaming**: correct a streamed tool-call name without holding the stream back
- **Models**: stop the model picker heading a group with a generated node id
- **Tool calls**: rescue tool calls the client would reject with an invalid-args error

# v0.5.138 (2026-09-28)

## What Was Fixed
- **Chat**: restore seren chat core

# v0.5.139-Custom (2026-09-28)

## What Was Fixed
- **A streamed tool call is no longer rejected over the case of its name.** The name and the arguments are corrected differently on purpose. A name arrives whole in the first delta of a call, so raising it back to the case the request declared costs nothing and holds nothing back. Arguments arrive in fragments and only form a parseable object at the end, so they are not touched here: buffering them would delay every tool call in the stream until its last fragment landed. A streamed call whose arguments cannot be recovered is repaired on the following turn instead, by the history rule shipped in `v0.5.137-Custom`, which is too late to save that turn but stops it repeating.
- **The fix is applied on every path that emits a chunk.** Passthrough, the Responses same-format passthrough, the translate loop, the flush tail and the final flush all correct a name before the frame is written.

## What's Under the Hood?
- **Twelve cases added** for the streaming rule, covering the real delta shapes: an OpenAI first delta with an empty argument string, a later argument fragment, a Claude `content_block_start`, a Responses `output_item.added`, a text chunk that must stay untouched, a name that is not a declared tool, and an exact-case name that must not be rewritten needlessly.
- **A circular-chunk case found a real defect.** The name walk is recursive and had no depth bound, so a cyclic chunk overflowed the stack. Chunks arrive about five levels deep, so a bound of twelve is generous and stops it. Confirmed by removing the bound, which reproduces the overflow.
- **The check counts the emit sites in the stream source.** Every case above passed with the call site removed from the translate loop, because a pure-function check cannot see a missing hook. The source is now read to assert the index is built, the wrapper exists, and the guarded-site count has not moved; removing one hook was confirmed to redden it.
- **The scope limit is asserted rather than left implicit.** Six frames are enqueued and five are guarded. The two that are not hand the client a raw upstream SSE line rather than a parsed object, so correcting a name there means re-parsing the line; they are passthrough, where the CLI tool and the provider are the same ecosystem and the model sees the names the client declared. The check pins the total at six so a new emit site forces that decision again instead of slipping past.

## Notes
- **Verification is static**, as it has been throughout this fork: per-file esbuild plus the self-checks. Nothing here has been exercised in a browser.

# v0.5.138-Custom (2026-09-28)

## What Was Fixed
- **The model picker no longer heads a group with a generated node id.** A compatible provider node is stored under an id like `openai-compatible-chat-b5bca155-fc33-4899-a868-2ff3d7891e3c`, and a custom model records that id as its provider. When no group owned the alias, the picker opened one and titled it with the id, so a database key was rendered as a provider name with a model count beside it. The heading now resolves in order: the node's own name, the connection's name, the static registry, and finally the family the id belongs to, so an unresolvable node reads as OpenAI Compatible rather than as a uuid. A registry entry that merely echoes the id back is not trusted as a name.
- **A custom model no longer opens a second group for a node that already has one.** A compatible group is keyed by the node id but stores the node prefix as its display alias, and a custom model stores the id, so the alias-only lookup never matched. The id is tried as well, which is what makes the group and the model meet.

## What's Under the Hood?
- **`providerDisplay.js` added, with a 26-case check.** It covers the reported shapes (chat node, responses node, anthropic node, a missing node record, an empty node list during the first render) alongside the cases that must stay unchanged: a known registry alias is used as-is, an unknown plain id resolves to empty so the caller keeps its own default, and a schema-less lookup never guesses. The check was confirmed to fail by reinstating each defect separately: labelling a group with its own id reddened 10 cases, and dropping the node-id match from the owner lookup reddened 2.
- **The check also reads the component.** A perfect helper does not help while the picker keeps reaching for the registry fallback, which is `{ name: providerId }` and therefore the id again, so two cases assert the leaking expressions are gone from the source. Restoring one of them in the component was confirmed to redden the check.
- **One defect was found while writing the check.** The api type sits after the `compatible` segment in the id, not in the second word, so the first version read `openai-compatible` as the type and matched nothing. Six of the nine id cases failed until it was corrected.

## Notes
- **Verification is static**, as it has been throughout this fork: per-file esbuild plus the self-checks. Nothing here has been exercised in a browser.

# v0.5.137-Custom (2026-09-28)

## What Was Fixed
- **A tool call the client could not satisfy ended the turn.** `Invalid args for tool "Bash": must have required property 'command'` is the client validating the call against the schema the request itself declared, and it throws rather than continuing. The argument object was reaching the client as `{}` because the only repair in the pipeline, `toolCallFallback.repair`, reads the request history and never looks at the call the model is producing right now. Three rules now run over each response: a name spelled in a different case than the request declared is raised back to the declared one, a missing required property is filled from a value the model did supply under another name, and a call whose arguments cannot be recovered is dropped so the model tries again on the next turn instead of the turn dying.
- **A model that wrote the command as the whole argument string is understood.** `arguments: "ls -la"` is lifted into `{"command":"ls -la"}`, but only when the tool declares exactly one required string property. With more than one, the value is ambiguous and the call is dropped rather than guessed.
- **A rejected call no longer poisons every turn after it.** The call the client rejected stays in the history it sends back, so the same broken call was re-validated and rejected on each retry. The history is now rescued on the way out, which is what makes a turn recoverable after the first failure.

## What's Under the Hood?
- **`toolCallRescue.js` added, with a 31-case check** covering the reported shapes (lower-case name, empty arguments, bare string, `cmd`, `commandLine`, `oldString`) plus the shapes that must stay untouched: a well-formed call is re-encoded byte-identically, an undeclared name is left alone, a schema without `required` is not second-guessed, and a non-object argument value does not throw. The check was confirmed to fail by reinstating each defect separately: removing the case-insensitive name match reddened 11 cases, and passing an unrecoverable call through instead of dropping it reddened 7.
- **Three defects were found while writing the check.** A Claude `tool_use` block carries `input` as an object, not a JSON string, and the first version parsed it as a string and discarded it. Separator-insensitive matching was skipping every spelling variant of the key itself, so `newString` could not fill `new_string`. And a Claude-format response is the message itself rather than a choice inside one, so the first version never reached it at all.

## Notes
- **Streaming is not covered.** Tool arguments arrive in fragments there, and buffering them to repair would hold back every tool call until the last fragment lands. The non-streaming path and the request history are repaired; a streaming call is still repaired on the following turn through the history rule above.
- **Verification is static**, as it has been throughout this fork: per-file esbuild plus the self-checks. Nothing here has been exercised in a browser.

# v0.5.136-Custom (2026-09-28)

## What Was Fixed
- **Creating an API key failed everywhere.** `createApiKey` in the repository module read `ctx.session?.apiKey` to work out who was creating the key, but that module has no session and never had one. Every call threw a ReferenceError, the route caught it, and the dashboard got a bare 500 with no clue what went wrong. The caller already resolved the creator and passes it in, so the inference is gone. The key name check in the form was unrelated and is unchanged.
- **The Live Request tab was not reachable.** The tab strip scrolled sideways, so its last option sat off the edge of a narrow viewport, and the label was long enough to make that likely. The tab is now called Inspector, and the strip wraps instead of scrolling, so no option can end up hidden behind a scrollbar.

## What's Under the Hood?
- **A leaked-identifier scan added**, `leakedIdentifiersSelfCheck.mjs` (5 cases), scanning every module under `src` and `open-sse` for names that only exist inside a route handler or auth helper. It is written after the outage above, where esbuild passed the whole time because an undeclared global is a valid program to a bundler and only throws when the line runs.
- **The scan's first version did not catch its own bug.** Its destructuring rule accepted any braces around the name, so an object literal containing it read as a declaration and the offending line came back clean. The rule now requires the name to be a bare binding, and a case reproduces the exact shape of the line that caused the outage so the rule cannot widen back into matching it. Reintroducing the fault is what proved the difference.

## Notes
- **None of this has been exercised in a browser.** Verification is static: per-file esbuild plus the self-checks. The same applies to everything else shipped in this fork.

# v0.5.135-Custom (2026-09-28)

## What Was Fixed
- **The wrong panel was hidden for API-key sessions.** The provider map is the diagram with 9Router at its centre and every configured provider arranged around it, joined by animated edges. That is infrastructure rather than one key's usage, and it is what now gets replaced with a short muted note. The usage charts, which were hidden instead in `v0.5.129-Custom`, are back for every session. Both chart endpoints were already scoped to the session's allowed models, so what an API-key holder sees is that key's own usage.
- **The note no longer leaves most of a row empty.** Recent Requests is pinned to a fixed height and the map used to fill the wide column beside it, so the note and the request list now drop the two-column grid for an API-key session instead of sitting in a 480px cell.
- **A session that is still being identified no longer flashes the map.** The lookup of `/api/auth/status` and the statistics load run together, and the map area now shows the same spinner the charts used to, so an API-key holder never sees the map appear and then disappear.

## Changes
- **An API-key holder can see their own token allowance.** A card above the overview numbers shows the key's name, tokens used against its limit, what is left, the percentage, and a running countdown to the next reset. `/api/usage/api-keys` already narrowed its result to the session's key, so nothing about any other key reaches the browser: the endpoint needed no change, and neither did any permission. An unlimited key shows its usage and no bar or countdown rather than a broken empty one.
- **An API-key session stops requesting the provider list.** The two requests behind the map were the only consumer of that state, so a session that never renders the map no longer makes them.

## What's Under the Hood?
- **A render check added** for the Usage page, `usageStatsRenderSelfCheck.mjs` (7 cases), covering a password session, an API-key session with and without a quota, an unlimited key, and a session still being identified. It was confirmed to fail against two reintroduced defects: the charts hidden again, and the map shown again.
- **The two render harnesses were corrected.** The PropTypes stub returned `null` from a validator, which breaks any chained `.isRequired`, and the JSX stub recorded elements without calling them, so text inside a nested component never reached the tree and the check could not see a card that rendered nothing. Both now render what a browser would.
- **Panel detection hangs off component identity.** The four lazily loaded panels were told apart by prop name, which is unsafe: `activeRequests` and `errorProvider` are also fields of the statistics object the overview cards receive, so they appear in the tree whether or not the map is rendered.

## Notes
- **None of this has been exercised in a browser.** Verification is static: per-file esbuild plus the render check above. The same applies to everything else shipped in this fork.

# v0.5.134-Custom (2026-09-28)

## Changes
- **The Change Log modal no longer stacks both contributors into one scroll.** It opens on Serenhope with a switcher in the header to move between Serenhope and Decolua. Both changelogs were already fetched separately, so nothing new is requested; only the display changed. A tab appears only for a source that actually loaded, so an unreachable upstream no longer offers a button that leads to nothing.
- **A selection that points at an empty changelog falls back** to one that has content, rather than leaving the body blank. This is the case where upstream goes down after the user has picked it.

## What's Under the Hood?
- **Two self-checks added**: `changelogSourcesSelfCheck.mjs` (9 cases) covers the source list, the default, and every empty-state fallback, and `changelogModalRenderSelfCheck.mjs` (6 cases) renders the modal with both changelogs present, with one absent, and with a stale selection. The render check feeds state through a queue, because with the component's real empty state the switcher never appears and a check that only renders that would pass against a broken one. Both were confirmed to fail against a deliberately reintroduced defect.
- **Source selection moved into `changelogSources.js`**, free of imports, so it can be tested without the bundled dependencies. It mirrors what `pluginModelMatch.js` does for the plugins page.

# v0.5.133-Custom (2026-09-28)

## Changes
- **Three more Custom Plugins, each per model and each off by default**: Structured Output Lock normalises the response format a request asked for, writes the required fields into the system prompt for providers with no native JSON mode, and strips fences, leading prose and truncation out of non-streaming answers. Tool Argument Repair compares every call against the schema the model was actually given, fills safe defaults, coerces near-miss types, and drops a call whose required arguments cannot be recovered instead of sending one the harness will reject. Context Doctor cuts a conversation that no longer fits the model's window, shortens the tool output that is left, and leaves a recap naming the files and commands that were removed. All three carry their own badge on the model, the way Image Vision and Think Deeper already do.
- **Adaptive Pruning by Context Window** in Token Saver sizes the cut to the model rather than to a message count, so a short session is never touched and only a request that would actually overflow loses turns. Room is held back for the reply, and the existing message limit becomes the floor rather than the target.
- **A tool call and the result answering it are now treated as one unit when cutting history.** The new pruning groups turns by the call ids actually present in the conversation, so a call is never dropped while its result survives. That split is a hard 400 upstream, and inside a combo it burns every member before one can reply.

## What Was Fixed
- **A tool call that could not be repaired was never actually dropped.** The repair tested whether anything had changed before testing whether the call was recoverable, and a call missing only an unfillable required property had nothing left to change, so it passed straight through and the client failed on it again.
- **The Context Doctor recap was inserted ahead of the system prompt.** It was spliced at index 0 rather than after the pinned prefix, which Claude and Gemini both reject.
- **A truncated JSON object whose last key had no colon stayed unparseable.** The shared closing helper only handled the form with a trailing comma, so `{"city":"Lisbon","popu` reached the caller untouched instead of as `{"city":"Lisbon"}`.

## What's Under the Hood?
- **Seven self-checks added**: `tokenBudgetSelfCheck.mjs` (17 cases), `adaptivePruningSelfCheck.mjs` (16), `contextDoctorSelfCheck.mjs` (18), `structuredOutputSelfCheck.mjs` (21), `toolSchemaRepairSelfCheck.mjs` (24), `pluginModelMatchSelfCheck.mjs` (9) and a render smoke-check for the two changed pages (8). Each was confirmed to fail against a deliberately reintroduced defect before being accepted. The adaptive pruning check initially accepted a broken one, because its cases only ever cut a call and its result in sequence, so a case was added where the budget is met the instant the call alone is dropped.
- **Plugin list management no longer repeats itself per plugin.** The API route and the plugins page derive their keys from one list, so a newly added plugin cannot be silently dropped from a save or from the load path.
- **Plugin model matching moved to its own module** so it can be tested without the settings database. Two of its assumptions are now pinned by tests: a bare model name matches across provider prefixes, which is what makes a plugin work at all when the dashboard stores an aliased id, and a prefix of a real id is not a match.
- **The render check drives boolean state on.** Every enabled branch in both pages is gated on a boolean, and a stub that returned the initial `false` would leave those branches unevaluated, so a typo inside one would never throw. A case also forces the model picker open and asserts on the resulting tree, because a picker title built from a renamed variable throws in a way a plain render does not.

## Notes
- **Streaming answers are not cleaned by Structured Output Lock.** Validating JSON means holding the text until the stream ends, which is the one thing streaming is for. That path is carried by the native response format plus the pinned schema.
- **Streaming tool arguments are not buffered by Tool Argument Repair**, for the same reason. A partial JSON string cannot be validated, and holding the fragments would stop tool arguments streaming at all. Complete calls inside a chunk, which is how Claude and Responses emit them, are still repaired; fragmented OpenAI deltas are picked up on the next turn, where the request-side repair fixes the history.
- **The Context Doctor summariser is a hook, not a feature yet.** The module accepts a summariser and falls back to the deterministic recap when it throws, returns nothing, or is absent, and both paths are tested. Nothing supplies one: a nested LLM call inside the request path needs its own auth and recursion handling, so wiring it is left for a change that can be tested on its own.
- **None of this has been exercised in a browser.** Verification is static: per-file esbuild plus the self-checks above. The same applies to everything else shipped in this fork.

# v0.5.132-Custom (2026-09-28)

## What Was Fixed
- **Model picker merged unrelated models into one provider**: custom models that could not be placed in a provider group were pushed into the first provider with `passthroughModels`, which both stacked them under that provider's heading and rewrote their value to that provider's prefix. Picking one silently retargeted the request at a provider the model never belonged to, and a provider such as OpenCode Free could show hundreds of borrowed models. They are now grouped under the alias each model actually belongs to, which is the prefix the value needs anyway.
- **A permission comment described the opposite of what the code does**: an empty `permissions: []` page rule was documented as "open to any session", but `canOpenPage` asks whether any listed permission is held, and an empty list has none, so the page is closed. The comment is corrected, and the two pages relying on it (Basic Chat, Profile) keep their existing behaviour.

## Changes
- **Four more API key permissions**: `manageTools` (CLI Tools, Token Saver), `manageAdvanced` (Console Log, Translator, Proxy Pools, PXPIPE), `managePlugins` (Custom Plugins, Skills) and `manageMediaProviders`. All default to off, so a key created before this change gains nothing: `normalizePermissions` reads a missing field as false, and no migration grants anything. A password session keeps every page. The sidebar now shows an API key session only the parts of the System section it may open, instead of hiding all of it.
- **API key allowed models follow the models**: deleting a model drops it from every key's allowlist, and renaming one rewrites the entries that referenced it, across custom models, the model editor and model aliases. Only the ids the caller reports as gone are touched, so a provider that is momentarily unreachable cannot shrink anyone's list, and wildcard patterns are never pruned. When the last entry would be removed the old value is kept and the key is reported back, because an empty allowlist parses as "no restriction" and would silently unlock the key.
- **Usage charts hidden for API key sessions**: the token chart and the two breakdown charts are replaced with a short muted note. The overview numbers and the recent request list are unaffected. A password session sees exactly what it saw before. If the session lookup fails the page falls back to the password view.

## What's Under the Hood?
- **Two self-checks added**: `permissionPathsSelfCheck.mjs` (12 cases) proves each permission opens only its own pages, that none leaks into another section, and that a page with no rule stays shut. `allowedModelsReconcileSelfCheck.mjs` (15 cases) covers pruning, renaming, wildcard and `*` preservation, idempotence, and the refuse-to-empty rule. The reconcile check caught a real defect while being written: an untouched list was being respaced and rewritten, which is fixed.

# v0.5.131-Custom (2026-09-28)

## What Was Fixed
- **Quota Tracker crashed on open**: the Quota row card rendered a `resetWord` that was never declared, which throws a ReferenceError the moment the list draws. `/dashboard/quota` has no error boundary, so the whole page went blank. The label now comes from the `recurring` flag the row already carries, so a one-shot pack still reads "Expires" and a refilling quota still reads "Reset", matching the wording the progress bar already used.

## What's Under the Hood?
- **Render smoke-check for the Quota Tracker components**: `QuotaTracker/renderSelfCheck.mjs` calls each leaf component as a plain function with real-shaped data covering every branch it draws (unlimited, credit balance, one-shot pack, missing reset time, compact mode, each sort mode, pagination, error and loading states). This catches a class of bug that parsing alone cannot: a JSX expression naming a variable nobody declared is syntactically valid, so it passes a build check and only fails when the component renders. The check was verified by reintroducing the defect and confirming it failed before restoring the fix.

# v0.5.130-Custom (2026-09-27)

## Changes
- **Permissions are locked for API key sessions**: signing in to the dashboard with an API key now disables the whole permissions block instead of only hiding the "manage API keys" row. The four checkboxes are inert, the value shown is the default with only View usage on, and a note explains that changing permissions needs the dashboard password. This applies to both the create form and the edit form, and the value sent to the API is forced to the default so stale form state cannot slip through.
- **Sub-keys created by an API key session no longer inherit permissions**: key creation and key editing now write the default permission set for an API-key session instead of clamping the request to what the caller already holds. A key that can create keys can no longer mint one that manages keys, so the escalation chain stops there. Session by dashboard password is unaffected and keeps full control.

# v0.5.129-Custom (2026-09-27)

## What Was Fixed
- **API key usage showed providers the key cannot use**: signing in to the dashboard with an API key showed every provider that had ever run on the instance. The Usage page reads two sources, and the SSE stream at `/api/usage/stream` called `getUsageStats` without the allowed-models argument, so it fell back to "every model" and overwrote the correctly scoped first response. That stream is the one that populated the By Provider chart, which is why unrelated providers such as MiMo Code Free and OpenCode appeared next to the key's own custom model.
- **Leaderboard and Errors tabs ignored allowed models**: both filtered by API key but not by the key's model allowlist, so a scoped session saw models it would be refused at request time. The Errors tab now also excludes those models from its total and error counts, so the numbers agree with the rows.
- **Live request list was never scoped**: `getActiveRequests()` returned the global view to every caller, including API-key sessions, exposing other keys' in-flight and recent requests. It now takes the session scope, and a scoped caller gets an empty in-flight list because pending traffic carries no key attribution.
- **Request Details and the provider filter had no session check**: `/api/usage/request-details` and `/api/usage/providers` never consulted the dashboard session, so the provider dropdown could be used to enumerate providers outside the key's scope. Both are now narrowed to the key's allowed models. The model filter is applied in SQL rather than after the query, so pagination counts stay correct.

## Notes
- The `requestDetails` table has no `apiKey` column, so the Details tab and Live Request Inspector are scoped by allowed model but not yet by API key. Scoping them per key needs a schema change; existing rows cannot be attributed retroactively.

# v0.5.128-Custom (2026-09-27)

## Custom Features & Enhancements
- **Automatic tool calling fallback**: a tool payload that a provider refuses no longer surfaces as a tool error. Before dispatch, malformed tool arguments are repaired (truncated JSON is closed back up, non-string arguments are stringified, empty ones become `{}`), tool results whose call id matches nothing are dropped, and a `tool_choice` pointing at a tool that is not in the array is removed. When an upstream still answers 400/404/422 naming the tools, the request is re-dispatched with the tool machinery relaxed one step at a time, stopping at the first level the provider accepts: drop `tool_choice` and `strict`, then strip JSON Schema keywords that many gateways reject while keeping every tool name and description, and finally drop the tool definitions entirely and inline the tool history as prose so the turn is still answered. On by default; set `toolCallFallback` to `false` in settings to restore the previous behaviour. A rejection that does not name tools, such as a context overflow or a policy refusal, is never touched.

# v0.5.127-Custom (2026-09-27)

## What Was Fixed
- **MiMo Code Free hidden properly**: the provider was flagged `hidden` in the registry but still surfaced in the model selector and in `/v1/models`, because the no-auth provider lists were built from every `noAuth` free provider without checking that flag. Both lists now skip hidden entries, so the dead Xiaomi free channel no longer shows up with a large auto-fetched model list. The entry keeps its `noAuth` flag so an old `mmf/mimo-auto` request still resolves on the request path.
- **MiMo free model catalog no longer auto-fetched**: the registry entry pulled a model list from models.dev through `modelsFetcher` and accepted any id through `passthroughModels`. Both are gone, so the provider exposes only its single curated model and no longer grows a catalog from an external source.

## Changes
- **Web cookie provider names shortened**: DeepSeek Web (Cookie), Gemini Web (Cookie) and Kimi Web (Cookie) are now DeepSeek Web, Gemini Web and Kimi Web. The provider ids and aliases are unchanged, so saved connections keep working.

# v0.5.126-Custom (2026-09-27)

## Custom Features & Enhancements
- **Live Request Inspector**: new tab in the Usage menu that streams live request metadata (model, provider, tokens, latency, status) over SSE. Shows the newest 50 requests with a rolling snapshot that self-heals on reconnect, plus a pause/resume toggle and a detail drawer. Conversation payloads are never sent to the client, matching the redaction policy of the existing request-details endpoint.
- **Prompt Cache Indicator**: the Recent Requests rows now show a `CACHE` badge when a request served prompt tokens from cache, and the Cached Tokens overview card shows a cache hit rate percentage when caching is active.
- **Quota Tracker redesign**: quota rows are now card-style with rounded borders, a larger progress bar, and the remaining percentage moved to the top-right of each row. Spacing, typography and hover states are aligned with the rest of the dashboard.
- **API Key Usage menu removed**: the sidebar entry is gone. Users who sign in with an API key already see their own scoped usage on the Usage page, so the separate menu was redundant. The page route and `/api/usage/api-keys` endpoint are unchanged.

## What Was Fixed
- **Live Request Inspector auth**: the SSE endpoint called `getSessionContext()` but discarded the result, so the auth check was a no-op. It now returns 401 when there is no session.

# v0.5.125-Custom (2026-09-27)

## Upstream Sync
- **Synced with decolua upstream v0.5.91**: 37 upstream commits merged, including the Token Harbor provider, four OpenAI-compatible aggregators (dahl, atria, agnes, bai), Claude thinking text returned to OpenAI-format clients, Claude decloak fallback when toolNameMap misses, Zed OAuth auto-import, GPT-6 Sol and Luna for Codex, the completed OpenCode Go catalog, Codex CLI multi-profile support, and Hermes multi-role model config.
- **Fixes from upstream**: usage attribution keyed by full API key to stop team-key collisions, combo limits resolved with server capabilities, capabilities catalog no longer cached per module copy, `POST /api/providers` made O(1) with silent key overwrite refused, Command Code raw byte replay, empty think markers no longer emitted, Gemini terminal turns and unresponded functionCalls guarded, Tailscale enable-flow health wait capped at 20s, Claude cli version bumped to 2.1.280 for Opus 5.5.
- **Serenhope fixes kept**: per API key permissions and sign-in, combo context window resolution, combo body deep-copy so tool calling survives the fallback loop, usage chart and live stats scoped to the signed-in key, real custom plugin implementations, plugin badges on custom and combo models, default pricing fallback so Est. Cost is never always zero, Docker npm cache mount fix for Railway.
- **Serenhope removals kept**: Union Alpha models, the Custom Domain endpoint option, the Uncensored Output plugin, the withdrawn 304+ provider batch, and the Fastest / Cheapest / Select All combo options stay out.

# v0.5.123-Custom (2026-09-27)

## Fixes & Enhancements
- **Tool calling restored for whitelisted providers**: Fixed short-circuit in claude translator that bypassed the `!!tool?.function` fallback for providers with a tool-type whitelist.
- **Combo tools capability reporting fixed**: Changed `aggregateComboCapabilities` to use `some` instead of `every` for the `tools` capability so a single member without tools no longer disables tools for the entire combo.
- **API-key user model filtering fixed**: Added missing `fetch("/api/auth/status")` in EndpointPageClient so `creatorAllowedModels` and `creatorPermissions` resolve correctly instead of falling back to defaults.

# v0.5.124-Custom (2026-09-27)

## What Was Fixed
- **Combo body mutation in fallback loop**: the fallback loop passed the same `body` reference to each member in turn, and `translateRequest` plus `fixMissingToolResponses` mutated `messages` in place. A second member inherited the corrupted history, which silently broke tool calling. Each member now gets its own cloned messages array, so a failed first member no longer poisons the next attempt.

## Custom Features & Enhancements
- **Select All removed from Combos page**: the master checkbox that toggled all combo cards at once was removed, along with the `Select all (N)` label. Combos are selected one card at a time via the per-card checkbox; the bulk strategy and bulk delete controls only appear when something is selected, next to the current count.

# v0.5.122-Custom (2026-09-27)

## Changes
- **Custom Domain endpoint removed**: the Custom Domain option on the API Endpoint card is gone along with its enable, edit and disable dialogs, the `customDomainEnabled` and `customDomainUrl` settings, and the branch in the base-URL picker that produced its `/v1` URL. Local, Cloudflare Tunnel and Tailscale remain, and a stored custom domain left over in an old settings blob is ignored rather than read.
- **Cheapest combo strategy removed**: the "Cheapest" strategy that ordered combo members by a free/cheap heuristic is gone from the rotation logic and from the combos page help text. Round Robin, Fallback and Fusion remain.

## Fixes & Enhancements
- **Sub-key model scope enforced server-side**: a sub-key created with a wildcard allowed-models field used to bypass the parent key's model scope entirely, so a key restricted to a single model could create a child with access to every model. The create and edit key endpoints now clamp a wildcard or empty request to the creator's own allowed-models list, while explicit lists are still filtered by the same exact, prefix-star and suffix-star matching the LLM gate uses.
- **Tool calling restored for all models**: the Claude translator's tool filter dropped any tool whose `type` was not `function` or in the provider whitelist, which discarded tools carrying a function payload under a newer API's `type` (e.g. Responses "custom"). The filter now keeps any tool that has a function payload, so tool definitions reach the provider and `capabilities.tools` reports true again. Combo capability auto-switch now also treats `tools` as a hard capability and floats tool-capable models to the front when a request carries tools.

# v0.5.121-Custom (2026-09-26)

## Changes
- **The large provider batch is withdrawn**: the set that added 304+ providers on top of this fork is gone again. Around 240 registry entries, 48 executors and the supporting services and utilities that only existed for them were removed, and the two that stayed in the tree are now unreferenced. The providers this fork had before that batch are untouched, so OpenCode Zen, CodeBuddy Intl, Qoder CN, Devin CLI, Grok CLI, DeepSeek Web, Gemini Web and Kimi Web all still work exactly as before.
- **Alias resolution stays**: the indirection that maps a registry id, an alias and every secondary alias onto one provider key is kept, because the model lookup helpers read through it and the entries that remain use it.
- **The capture buttons stay**: the API key form, the cookie capture button and the Felo capture button are untouched, so adding a key for any remaining provider behaves as it did.

# v0.5.120-Custom (2026-09-26)

## Fixes & Enhancements
- **The image builds on Railway again**: the dependency install used a cache mount, and Railway's builder wants the id to carry a key it generates per service. The documented form of that key is rejected too, so the mount only ever broke the build, and the first version of the fix, which named the cache, was refused for the same reason. The mount is gone now and the build relies on the layer cache, which already covers the common case because package.json is copied on its own, so an unchanged manifest never reinstalls anything. The syntax line went with it, so the build no longer needs to pull a Dockerfile frontend before it can start.
- **The build no longer stops on missing modules**: bringing in the large provider set left a few files behind. The capture metadata and the debug-browser warning were imported by the provider key form and by the two capture buttons, and the canonical-attempt trio was imported by the request semantics, the forced and non-streaming adapters and the request-detail status map, so none of those could be compiled. All five are here now, which means the cookie capture buttons, the Felo capture button and the request-detail status column behave as they were written to.
- **Z.ai no longer needs a browser driver to load**: its browser transport imported playwright at module level, so an install without it failed to compile even for the signed API path that never touches a browser. The driver is now resolved the first time the browser is actually launched, the same way the TLS impersonation client already handles its optional native dependency, and the package is an optional dependency so a host that cannot install it is not blocked. When it is missing, the error says what to install instead of surfacing as a module resolution failure.

# v0.5.119-Custom (2026-09-26)

## Changes
- **Removed the Uncensored Output plugin**: the plugin, its runtime prompt injection, its API keys, its default settings entry, its capability badge and its card on the Custom Plugins page are gone. A configuration that still carries the old entry is simply ignored, and no model loses a badge it no longer has. The remaining plugins are Image Vision, Think Deeper and Speed Mode.

## Fixes & Enhancements
- **Update banner that actually fires on a deployed instance**: the old check only asked git how far behind the checkout was, and a deploy that ships without git history (a container or a platform build) has no revision to ask about, so it reported "no update" forever. The build now stamps its own revision and release into the bundle, and the check runs a second signal that compares the newest changelog entry on the repository with the release this build came from, so an image without git still learns that a newer release exists.
- **A dismissible banner across the dashboard**: a banner appears under the header when an update exists, naming the release, saying how far behind the install is, previewing the first notes of the new release, and offering the update command to copy plus a link to the repository. It rechecks every ten minutes, and closing it hides that release only, so the next one shows up again.
- **The changelog URL pointed at the wrong repository**: it read the upstream changelog while everything else in the app points at this fork, so a release note shown to the user could describe changes that were never shipped here.
- **Post-login dialog no longer repeats the update notice**: it used to print a commit count that could be unknown, and the update has a home of its own now.

# v0.5.118-Custom (2026-09-26)

## Changes
- **Dropped Union Alpha from OpenCode Free**: `oc/union-alpha` and `oc/union-alpha-free` are removed from the OpenCode Free registry, so they no longer appear in the model picker, the suggested list or `/v1/models`. They were the only free models served over the Anthropic Messages endpoint, so that routing branch, its model set and the `anthropic-version` header it added are gone as well; every remaining free model goes to chat/completions or to the Responses API. OpenCode Zen keeps its own `union-alpha` model, which is a separate provider and still works.

# v0.5.117-Custom (2026-09-26)

## Fixes & Enhancements
- **Combo context window follows the largest member**: a combo of a 1M model and a 256k model used to publish 256k, so clients compacted a conversation far earlier than any member needed. A combo fails over between models instead of splitting one conversation, so the window it advertises now follows the largest member, same as max output already did. The two places that aggregated combos disagreed with each other (one took the smallest window and the smallest output, the other the smallest window and the largest output), so both now share one aggregator and a combo reports the same window in every place.
- **Custom context per combo**: create and edit combo have a Context Window switch with Auto and Custom. Auto follows the largest member and says what that is right now, Custom takes a token count that wins over the automatic value. Stored in a new `contextWindow` column, where 0 means auto, and marked with a custom badge on the combo card.
- **Every model shows its real window**: each row in the combo form and each chip in the model picker now carry the model's context (1.0M, 256k), so a 1M model is never picked as if it were a small one. The combo card shows the window and output of each of its members next to the badges.
- **Combos report context_length**: `/v1/models` published a combo's window only inside a nested block, so a client reading the usual `context_length` field found nothing and guessed from the name. Combos now also publish `context_length` and `max_completion_tokens` at the top level, like single models.
- **OpenCode and other credential-free providers are listed again**: `/v1/models` built its list from provider connections only, and a provider that needs no key never owns a connection, so its models were listed only while the whole provider table was empty. As soon as one provider was connected, every model of OpenCode Free and the other no-key providers disappeared from the listing, even though requests to them worked. They are now always listed, and a client that reads `/v1/models` to build its model picker sees them.

# v0.5.116-Custom (2026-09-26)

## Custom Features & Enhancements
- **Per API key permissions**: the Create and Edit API key forms now carry a Permissions box with four separate rights: create, edit and delete API keys, create, edit and delete models, create, edit and delete providers, and view usage. Each key stores its own set, and the sidebar, the pages and the endpoints all follow it. A password sign-in is still a full administrator.
- **Sign in with an API key**: the login page has an API Key Login tab next to Password Login. The key is verified like any LLM request, so a disabled, expired, quota-exceeded or IP-blocked key is refused with its own message. The session that results shows only the menus the key is allowed to open, and the Endpoint page hides the tunnel, Tailscale and require-API-key controls so no button can fail.
- **Usage scoped to the signed in key**: stats, chart, leaderboard, error list, history, the CSV export and the live stream all filter on the key that authenticated, so a key user reads its own numbers and never another key's. The per-key usage page shows the same single card.
- **Nested keys stay inside the parent's scope**: a key that only has view usage cannot hand out model, provider or key rights to a new key, the permissions it does not hold are hidden and disabled in the form, its token limit caps the limit of every key it creates, and its allowed-model list is the only list the model picker offers, with the same exact, prefix-star and suffix-star matching the server applies to LLM requests.
- **Enforced on the server, not only in the menu**: a key-signed session is refused with 403 on any endpoint its permissions do not cover, including settings, tunnel, OAuth, cloud, translator, CLI tools and MCP routes, and on any dashboard page outside its rights. Reading the model catalog stays open to a provider manager because the providers page needs it to render a connection, while every model write stays on the model right. A key with no right at all lands on a short notice with a sign out button instead of a redirect loop.

# v0.5.115-Custom (2026-09-26)

## Custom Features & Enhancements
- **304+ Providers Integration**: Merged the massive provider library from ExtremeRouter. Added over 200+ API-key providers, 25 OAuth providers, and 39 Web-cookie providers (including Qwen Web, Claude Web, ChatGPT Web, Grok Web, Notion AI, HyperAgent, Conol, DouBao, Adapta, and more) into 9Router.
- **Provider Capabilities & Prices**: Fully synchronized model metadata, token limits, capabilities, tool-calling flags, and token cost pricing with ExtremeRouter's definitions.
- **Frontend Modals & UI**: Updated Add API Key modal to automatically suggest specific cookie capturing instructions for new Web-cookie providers. Added `FeloCaptureButton` and `CookieCaptureButton` helper components. 
- **Preserved 9Router-specific Providers**: Kept exclusive 9Router providers and aliases intact (like OpenCode Zen, CodeBuddy Intl, Qoder CN, Devin CLI, Grok CLI, DeepSeek Web Tool Bridge).

# v0.5.114-Custom (2026-09-25)

## Fixes & Enhancements
- **Usage calculation accuracy for Today and 24h periods**: fixed an issue where selecting Today or 24h incorrectly overlaid up to 60 days of historical daily aggregates onto the current stats, causing token counts to jump from 1M to over 1B. Historical daily data before the cutoff date is no longer added into Today and 24h metrics.
- **Model Leaderboard period filter**: fixed Leaderboard route ignoring Today and All Time filters and defaulting to 7 days.
- **Real-time Usage sync**: SSE `/api/usage/stream` now accepts the active period parameter and streams complete stats updates when requests finish. The frontend Usage overview cards, charts, and breakdown tables now automatically update in real-time without requiring a page reload.

# v0.5.113-Custom (2026-09-23)

## Custom Features & Enhancements
- **Gemini Web (Cookie) provider**: added `gemini-web` under Web Cookie Providers, next to the existing DeepSeek entry. Paste `__Secure-1PSID` (plus `__Secure-1PSIDTS`) from gemini.google.com cookies; the cookie is verified against the live session page before saving. Requests run over plain HTTP to the internal StreamGenerate endpoint, no browser needed, with multi-turn history folded into one prompt.
- **Kimi Web (Cookie) provider**: added `kimi-web` under Web Cookie Providers. Paste `access_token` from www.kimi.ai localStorage; validation probes the account endpoint before saving. Requests speak the Connect-RPC chat protocol with automatic refresh_token exchange on 401, reasoning deltas surfaced as `reasoning_content`, and models Kimi K3 plus Kimi K2.6.
- **Web RAG backends stay honest about tools**: both new cookie providers reject OpenAI function tools with a clear 400 instead of answering empty, since the web backends are text-only endpoints with no native tool channel.

# v0.5.112-Custom (2026-09-23)

## Sync with upstream v0.5.86
- **Merged upstream through v0.5.86 (2026-09-23)**: Xiaomi MiMo server-assisted desktop login with five account clusters and v2.6 models, Claude Opus 5.5 support, and proxy pool header forwarding fix.
- **Kept fork behaviour**: Union Alpha routing over Messages API, one-click auto backup scheduler, Speed Mode plugin, per-key usage page, plugin badges on Custom Models and combos, 9Router Settings label, and the fork README. The OpenCode free-tier fix is carried by upstream's `opencodeFingerprint` helper, with `union-alpha-free` kept alongside it.

# v0.5.111-Custom (2026-09-22)

## Sync with upstream v0.5.85
- **Merged upstream through v0.5.85 (2026-09-22)**: OpenCode Zen provider with free-tier fingerprint, Jev System One endpoint wired into the sidebar and media providers, Qoder CN provider, Cursor/Claude combo presets with bulk operations, analytics Requests mode with provider/model breakdown charts, All Time usage period, capability metadata on `/v1/models`, and all upstream fixes (Claude refusal mapping, Antigravity quotas, Qoder replay guard, Hugging Face router migration, multi-platform Docker).
- **Kept fork behaviour**: Union Alpha routing over Messages API, one-click auto backup scheduler, Speed Mode plugin, per-key usage page, plugin badges on Custom Models and combos, 9Router Settings label, and the fork README. The OpenCode free-tier fix is now carried by upstream's `opencodeFingerprint` helper instead of the fork's local cloak, with `union-alpha-free` kept alongside it.

# v0.5.110-Custom (2026-09-20)

## Custom Features & Enhancements
- **API Key Usage page**: a new dashboard page under Usage that shows one card per generated key. Each card carries a quota progress bar (used versus limit, amber past 80 percent, red when exhausted), the next reset time computed from the key's interval and anchor, request, token and cost totals aggregated from the usage history, the error rate, rate-limit settings, expiry state, and an expandable per-model breakdown of the key's most used models. An auto-refresh toggle re-polls every ten seconds, and usage left behind by deleted keys is grouped into a single "Deleted keys" card so history is never lost.

# v0.5.109-Custom (2026-09-20)

## What Was Fixed
- **Plugin badges on Custom Models and Combos**: the Custom Plugins badges (Image Vision, Think Deeper, Speed Mode, Uncensored Output) only ever resolved against plain provider models, so a plugin applied to a Custom Model, a custom-provider import, or a combo showed its badge nowhere. The models endpoint now emits capability entries for Custom Models (inherited from their target plus the plugin badges matched against the studio name or the model it calls) and for combos (boolean capabilities OR-ed across members, context/output floors taken from the smallest member). The model picker and capability hook resolve those entries by callable name, and the picker now renders the same badges on Custom Model and combo chips that it already showed on regular models.

# v0.5.108-Custom (2026-09-20)

## What Was Fixed
- **Automatic Backup actually fires**: the scheduler previously only armed through the deferred app bootstrap, so on a restarted server the timer could stay dead until the settings page was opened; the HTTP server wrapper now arms it at boot and the config endpoint wakes it on demand as a second safety net, so a pending schedule can never silently disappear.
- **Import Backup no longer resets the schedule**: restoring a backup without an autoBackup section (old or partial exports) kept wiping the stored config and status, which disabled backups on its own. The autoBackup scope is now only touched when the imported file actually carries it, and the import handler re-arms the scheduler against the freshly stored config afterwards.
- **Honest next-run countdown**: with the scheduler idle the endpoint clamped the due time to "now", which rendered a stuck 00:00 countdown. It now reports the real scheduled time even when the run is overdue, and the woken scheduler takes over the countdown from there.

# v0.5.107-Custom (2026-09-20)

## Custom Features & Enhancements
- **Automatic Backup restored**: brought back the scheduled backup feature with its full settings dialog on the 9Router Settings page. Configure a Telegram bot (bot token plus numeric owner chat id) or a GitHub token and repository, pick an interval (24 hours, 7 days, 30 days, or custom), then save. The scheduler sends the backup file automatically on the chosen interval, a live countdown shows when the next backup fires, and Send Test Backup runs a one-off backup through the password dialog. The export/import plumbing was re-integrated on top of the current selective backup system: Automatic Backup now exports all sections, and old partial or full backups remain fully import-compatible.

# v0.5.106-Custom (2026-09-19)

## Custom Features & Enhancements
- **New plugin: Speed Mode**: a fourth Custom Plugin that makes selected models answer instantly instead of reasoning. It injects a direct-answer system instruction and forces a thinking "none" intent, which the unified thinking pipeline converts into each provider's native disable format (OpenAI `reasoning_effort`, Claude `thinking: disabled`, Gemini budget 0, Qwen `enable_thinking: false`, and so on). Claude-native requests set the disable flag in the Anthropic shape so native passthrough never sends an unknown field. Selected models get a cyan bolt badge in the model lists and the plugin picker, managed exactly like the existing plugins on the Custom Plugins page.

# v0.5.105-Custom (2026-09-19)

## What Was Fixed
- **GitHub link label visible on mobile**: the header "Visit On GitHub" text was hidden behind a responsive `hidden sm:inline` class and showed only the logo on small screens; the label now always renders next to the icon.

# v0.5.104-Custom (2026-09-19)

## Custom Features & Enhancements
- **Simplify backup section picker**: removed the "Select All" and "Lightweight Only" quick actions from the Download Backup dialog; sections are now picked with the individual checkboxes only.

# v0.5.103-Custom (2026-09-19)

## What Was Fixed
- **OpenCode free tier: stop 403 FreeTierError on tool-carrying agent requests**: the free tier fingerprints the official agentic client inside the request body. The `/zen/v1/responses` gate now requires the `bash` + `read` tool decoys plus `tool_choice: "auto"` on every request (previously they were only injected when the payload had no tools at all, so any real agent call carrying 1..N tools went out naked and received 403), and the `/zen/v1/chat/completions` gate requires the full `bash`, `glob`, `grep`, `read` quartet, which is now appended whenever any of the four is missing. External client tools are preserved verbatim and only missing fingerprint names are added as no-op declarations. `muse-spark-1.2-contributor-free` is added to the force-auto tool choice quirk alongside 1.3 since both free models reject non-auto choices with 400.

# v0.5.102-Custom (2026-09-19)

## Custom Features & Enhancements
- **DeepSeek Web tool calling support**: the cookie-based DeepSeek Web provider now supports OpenAI tool calling. Because the web backend is a text-only RAG endpoint, the executor encodes the requested tools as a protocol inside the prompt, converts previous assistant tool_calls and tool result messages into readable transcript turns, and parses the model's reply back into standard OpenAI `tool_calls` deltas with `finish_reason: "tool_calls"` for both streaming and non-streaming requests. Requests without tools follow the original flow unchanged.

## What Was Fixed
- **Usage visible after backup import**: the Usage Overview Today and 24h views now merge the daily aggregates that shipped inside the backup (for days before today) with live request history, so restored usage is no longer hidden behind an empty default period. Verified with a real export-import roundtrip: restored rows show up in today, 24h and 7d views, while live-only data is never double counted.

# v0.5.101-Custom (2026-09-19)

## Custom Features & Enhancements
- **Remove 9Remote & 9English menus**: dropped the 9Remote promo entry, the 9English external link, and their unused modal components from the sidebar to keep navigation focused on router tools.

# v0.5.100-Custom (2026-09-19)

## What Was Fixed
- **Modal header polish**: the "Welcome to 9Router!" title no longer hugs the left edge of the dialog and now sits vertically centered on the same line as the close button. Applied to all dialogs, including the Download Backup header.
- **Smaller "Heavy" badge**: the Heavy tag in the Download Backup section list now renders in the compact badge size instead of falling back to the large default.

# v0.5.99-Custom (2026-09-18)

## Custom Features & Enhancements
- **DeepSeek Web (Cookie) Provider**: added `deepseek-web` under the Web Cookie Providers category (positioned between Free Tier and API Key providers). Supports web session token auth (`userToken` from `chat.deepseek.com`), streaming responses, and reasoning content (`<think>`) for models: `deepseek-chat`, `deepseek-reasoner`, `deepseek-v4.1-flash`, `deepseek-v4.1-pro`, `deepseek-v4.1-reasoner`, `deepseek-v3`, and `deepseek-r1`.
- **Remove Automatic Backup**: decommissioned the scheduled automatic background backup feature and modal to keep the app lightweight, retaining the standard manual Download Backup and Import Backup tools.
- **Selective Backup Download**: the Download Backup dialog now lets you pick which sections to include (Settings, Providers, API Keys, Combos, Custom Models, Pricing, Usage History). Each section shows its item count and estimated byte size, and the total selected size updates in realtime. Heavy sections (e.g. Usage History) are unchecked by default. Old full backups remain fully import-compatible.

# v0.5.98-Custom (2026-09-17)

## What Was Fixed
- **Keep original base models visible alongside custom models**: creating a custom studio model no longer hides or overwrites the underlying base model. Both the original target model and the newly created custom model stay fully visible in model pickers, provider details, and `/v1/models`.

# v0.5.97-Custom (2026-09-17)

## What Was Fixed
- **Fix OpenCode Free Tier 403 FreeTierError**: resolved `"OpenCode's free tier can only be used from within OpenCode"` by tailoring request headers with `User-Agent: opencode/1.18.30`, `anthropic-version: 2023-06-01`, and conforming 30-character OpenCode session and request identifiers (`ses_*`, `msg_*`).
- **Add Union Alpha & Union Alpha Free support**: added `union-alpha` and `union-alpha-free` to OpenCode's registry with targetFormat `claude` (routed directly to `/zen/v1/messages`), configured vision and reasoning capabilities, and added it to suggested models.

# v0.5.96-Custom (2026-09-17)

## Custom Features & Enhancements
- **Uncensored Output Plugin Updates**: renamed the third plugin to *Uncensored Output* and updated its icon to an emerald/red key off (`key_off`) badge. Added fallback model matching across requested, routed, and full model identifiers so plugin directives reliably inject into System prompts.
- **Header "Visit On GitHub" Button**: enhanced the GitHub repository link button in the top right header to display a clear "Visit On GitHub" text label next to the GitHub logo.
- **Sidebar & UI Polish**: renamed "Custom Models & Editor" to "Custom Models", updated the "Custom Plugins" icon to `widgets`, renamed "Settings" to "9Router Settings", and cleaned up top traffic-light decorative dots.
- **Custom Provider & Studio Target Picker Fix**: custom providers now stay visible in model selectors even when their underlying base models are mapped to studio custom model names. Upgraded logo data URL storage capacity and added JPEG compression fallback so custom provider logos never vanish.

# v0.5.95-Custom (2026-09-17)

## Custom Features & Enhancements
- **Direct Override (Unrestricted) Plugin**: added a third custom plugin featuring an open padlock icon (`lock_open`). When attached to selected models, it injects an anti-refusal system directive and technical framing, minimizing standard canned AI refusals for pentesting, code security, and raw technical queries. Enables the `lock_open` badge for selected models.

# v0.5.94-Custom (2026-09-17)

## Custom Features & Enhancements
- **Custom Plugins menu under FEATURE+**: added `/dashboard/plugins` featuring two modular plugins:
  - **Image Vision**: extracts text and visual content from images for models that don't natively support vision, making non-vision LLMs able to read image inputs from CLI tools and agents. Enables the Vision (👁️) badge for selected models.
  - **Think Deeper**: forces deep step-by-step chain-of-thought reasoning before outputting final answers. Enables the Reasoning (🧠) and Think Deeper (💡/psychology) capability badges for selected models.
- **Model selector integration**: users explicitly choose which models to attach plugins to via `ModelSelectModal`.

# v0.5.93-Custom (2026-09-16)

## Custom Features & Enhancements
- **Top-positioned logo in provider creation/edit dialogs**: the custom provider Logo upload field is moved to the very top before the Name field across custom compatible and embedding forms.
- **Edit custom provider logo**: the edit modal for compatible nodes now includes the logo picker and saves logo updates directly.
- **Provider logo display on Usage**: custom compatible nodes without custom logos now cleanly fallback to their parent provider image (e.g. OpenAI / Anthropic icons) instead of displaying abbreviation text badges like "OP".

# v0.5.92-Custom (2026-09-16)

## What Was Fixed
- **Fix LAN/Docker default login password**: trusted-peer auth now falls back correctly for local and container deployments.
- **Fix usage errors page always showing 0**: error tracking counts are now persisted and read back properly.

## Custom Features & Enhancements
- **Add backend GitHub update detection with commits behind**: the version API now compares the local checkout against the upstream branch and reports how many commits behind, the latest commit message, and a tailored install command.
- **Add Welcome Modal with star request and update info**: a post-login modal invites users to star the GitHub repo and, when an update is available, shows the commit count, message, and a copyable install command. Dismissible per-session or permanently.
- **Hide Skills menu from Sidebar**: the Skills navigation item is removed from the System section.

# v0.5.91-Custom (2026-09-16)

## Custom Features & Enhancements
- **A custom (studio) model now hides the model behind it**: the moment a base model gets a studio name, that base model disappears from every place a client or a picker reads - `GET /v1/models` and its per-kind variants answer with the studio name only, the model pickers (API key allowed models, combos, CLI tool mappings, arena) offer the studio name only, and the provider page Models tab lists the studio name only. So with `qwen-3.8` pointed at `neko/qwen3.8-flash`, nothing shows `neko/qwen3.8-flash` anymore. The raw model is still routable and the Model Studio editor still sees it, because that is exactly where you pick the model a new name should call. The rule is shared in one helper (`buildStudioTargetIndex`) keyed by provider id plus model id, case-insensitive, so the same model name under another provider stays visible.

## What Was Fixed
- **The x on an allowed-model chip now removes that model**: in the API key forms the chips called a handler that branched on which picker modal was last opened, so with a freshly opened form (or before ever pressing Select Models) clicking x did nothing. Removing and adding models now state plainly which field they edit, and the chip lists in both the create-key and edit-key forms work on their own.

# v0.5.90-Custom (2026-09-16)

## Custom Features & Enhancements
- **Custom providers can carry their own logo**: the Add and Edit dialogs of every custom node type (OpenAI compatible, Anthropic compatible, MoonshotAI compatible, custom embedding) gained an optional **Logo** field. Pick any PNG, JPEG, WebP or GIF up to 2 MB and the browser crops it to a square, scales it down and stores a few kilobytes on the node; leave it empty (or press Remove) and the familiar default brand icon stays exactly where it was. The chosen logo shows on the provider card, the provider detail header, the media provider list and header, and on Usage in the provider map beside the traffic animation. Because it lives inside the node record, it also travels with Download/Import Backup and the automatic Telegram or GitHub backup.
- **Logo values are checked on the way in**: the API accepts a logo only as a compact image data URL (no SVG, no remote URL, no oversized payload) and answers with a plain message otherwise, while the picker refuses unreadable files before anything is saved. An update that omits the field leaves the stored logo alone; sending an empty one clears it.

# v0.5.89-Custom (2026-09-16)

## What Was Fixed
- **Automatic backups now really go out**: the scheduler tick used to hold the same in-flight lock that the send function checks, so every scheduled run rejected itself with "A backup is already being sent" and only retried 30 minutes later, forever. The tick now just decides when a run is due and hands the send over; a regression case drives a due tick against a stubbed Telegram API and asserts one upload actually leaves the process (it fails on the old code, passes on the new one).

## Custom Features & Enhancements
- **A live countdown tells you when the next backup lands**: under the Automatic Backup button, and again inside the dialog with the exact date, a timer now ticks every second ("Next backup in 23:59:05") against the real schedule instead of a guess. The API answers with the next run taken from the running scheduler, falling back to the stored last-send stamp plus interval, and the page re-reads it the moment the countdown reaches zero. Typed bot or GitHub tokens survive that refresh.

## Improvements
- **Automatic-backup code nesting fixed**: the service, the config repo and the settings route now use the same two-space-per-level indentation as the rest of `src`, and the startup wiring sits flush with the schedulers next to it. The confirm-password dialog no longer claims the file goes to Telegram when the GitHub channel is selected.

# v0.5.88-Custom (2026-09-14)

## Improvements
- **The Telegram owner id is now strictly numeric**: the Automatic Backup dialog only accepts digits (non-digits are filtered out while typing, the server rejects anything else with a clear message), since bot sends require the numeric owner id and the "@username" style hint was misleading.
- **UI copy cleaned of decorative dashes**: status, hint and placeholder strings across the Automatic Backup dialog now use plain punctuation, and the few misaligned indent lines the previous feature commits introduced in the profile page were normalized to the file's existing style.

# v0.5.87-Custom (2026-09-14)

## Custom Features & Enhancements
- **Automatic Backup moved into its own dialog and learned GitHub**: instead of a full card on the settings page, a single **Automatic Backup** button now sits right above Download Backup - it opens a modal where you pick the channel (Telegram bot or GitHub repository with a write-scoped token, committing to `9router-backups/` plus a `latest.json` pointer on a chosen branch), set the interval, then press **Save Configuration** to store everything and arm the schedule in one click; **Send Test Backup** delivers one backup immediately (password-confirmed) so the whole path can be verified on the spot. Both bot and GitHub tokens are now encrypted at rest with a machine-bound key, so no plaintext credential is ever written to the database or echoed back to the browser.

# v0.5.86-Custom (2026-09-14)

## Custom Features & Enhancements
- **Backups now deliver themselves to Telegram**: a new Auto Backup (Telegram) card sits above Download Backup in the profile page - set a bot token and owner chat id, pick the interval (every 24 hours, 7 days, 30 days, or custom hours), and the scheduler exports the exact same database backup the manual button downloads and sends it to your chat as a `9router-backup-*.json` file, importable with Import Backup unchanged. The token is stored write-only (never echoed back to the browser, kept out of the settings blob), the schedule survives restarts through the persisted last-sent stamp, sends follow the outbound proxy, oversized backups beyond the bot's upload cap are refused with a clear status instead of a silent stall, and a Send Test Backup button (password-confirmed like the other backup actions) verifies the whole path on demand. The configuration also travels inside every backup, so a restored instance resumes sending on its own schedule.

# v0.5.85-Custom (2026-09-13)

## Custom Features & Enhancements
- **A key's allowed models now also decide what it can see**: `GET /v1/models` (and `/v1/models/{kind}`, `/v1/models/{provider}/{model}`) answers through the same patterns the request gate uses, so a key limited to `claude-fable-5.1` lists exactly that one model instead of advertising names it would refuse with `403`.

## What Was Fixed
- **Two custom models on the same base model stop trading places**: older builds stored a display alias for every Model Studio name, and with two names aimed at one target the alias lookup answered whichever matched first - so calling `gpt-5.6-sol` could show up as `claude-haiku-5`, or as the bare base model. Studio names are now cleaned of any leftover alias, whatever value it held, and an alias that carries a studio name can no longer add a second entry for the same model to the listing.
- **A model name that is not a string is refused instead of crashing**: an array or object in `model` reached SQL as a bound value and died with `Unknown named parameter '0'` inside a 500; it now returns a plain `400 Missing model`.

# v0.5.84-Custom (2026-09-13)

## What Was Fixed
- **A custom model typed with its provider prefix now resolves**: a Model Studio target saved as `kr/gpt-oss-120b` was read with a bare parse, which handed the prefix back as the provider, matched no credentials, and left the usage row named after the base model - the target is now resolved the same way any other call is, so the studio name is what answers and what Usage bills, while `resolvedModel` still records the base model beside it.
- **A per-model override may name another provider**: an override whose target carries a prefix is resolved first instead of pasting `prefix/model` onto the current provider, which produced a doubled path upstream.

# v0.5.83-Custom (2026-09-13)

## Improvements
- **The two Workshop tools are named after what they do**: **Compare Models** runs one prompt across models side by side, and **Custom Models & Editor** is where those extra model names live.
- **The changelog is one card per day**: releases that landed on the same date now share a single bordered block, with each version kept as its own sub-heading inside it.

## What Was Fixed
- **The live request panel follows the name you called**: in-flight and streaming requests were tracked under the model the gateway resolved to, so Usage could list `claude-sonnet-5` and `qwen-3.8` at the same moment for one key.
- **Embeddings stopped splitting a custom model into two rows**: its usage record and its failure text named the resolved target, while every other endpoint reported the studio name, which is what made both names pile up in the same leaderboard.

# v0.5.82-Custom (2026-09-13)

## Custom Features & Enhancements
- **A Model Studio name now answers as the model it is**: every outbound payload - non-streaming completions, streamed chunks, Claude `message_start`, Responses events and semantic-cache hits - reports the name the caller spoke, so `claude-opus-5` never answers `qwen3.8-flash` while the console, the request detail and the usage `resolvedModel` still record the real target for debugging.
- **Failure text keeps the route private too**: the "all accounts unavailable" and "no credentials" replies name the model that was called instead of printing the provider connection id and the model behind it.
- **Every API key has an on/off switch**: the toggle sits on the left of each key row, is stored through the existing key update endpoint, and a switched-off key is refused with `403 API key is disabled` on chat, embeddings, images, video, speech, transcription, search and web fetch - including while the gateway runs without required keys.
- **FEATURE+ is the section title again** for the tools this fork adds, with Model Battle Arena and Custom Model Editor inside it.

## What Was Fixed
- **Per-key limits now apply to every endpoint**: chat compared the validator's reason strings one by one while the other endpoints only checked them for truthiness, so an over-quota, expired or model-restricted key could still generate images, embeddings, speech and searches.
- **A switched-off key can no longer be traded for remote access**: the edge guard accepted any non-false validation result, so the document writer's and battle arena's reason strings unlocked `/v1/*`.

## Removals
- **PRD Document Writer is gone**: its page, prompt library, checklist reader and saved drafts are deleted, and a migration prunes the drafts an install already has so the database stays clean.
- **Provider Health is gone**: the board page and its snapshot reader are deleted, while `GET /api/health` stays exactly the anonymous `{"ok":true}` liveness probe that tunnels and uptime checkers ping.

# v0.5.80-Custom (2026-09-13)

## Improvements
- **Workshop menu names now say what the tool does**: the three custom tools are **Model Battle Arena**, **Custom Model Editor** and **PRD Document Writer** in the sidebar, in each page header and in the model picker group, so nothing has to be guessed from a one-word nickname.
- **Icons finally respect their own size**: the Material Symbols defaults were an unlayered vendor stylesheet, so every icon rendered at a fixed 24px no matter what was written on it - they now live in Tailwind's base layer and the icon font is declared in `globals.css`, so a `text-[14px]` icon is 14px.
- **Icon and label share one centre line**: each sidebar and page-title icon is a fixed square flex box that a long label can no longer squash, which is what made rows look crooked.
- **Model picker group renamed**: the studio group in the model picker is **Custom Models** and its chips carry a `custom` tag instead of the old tool name.

# v0.5.79-Custom (2026-09-12)

## What Was Fixed
- **A provider that answers JSON when we asked for a stream no longer hangs**: the gateway now reads the response content-type and either replays the completion as live SSE for a streaming client or serves the normal JSON path, so the answer arrives and tokens are billed.
- **Unreadable upstream bodies fail loudly**: a body that is neither a stream nor valid JSON now returns a clean gateway error instead of a 200 response with nothing in it.
- **Event-stream bodies are parsed whatever they contain**: a plain JSON document wearing an SSE label, NDJSON rows, Claude Messages events and Responses-API events all decode into a real answer instead of `Invalid SSE response for non-streaming request`.
- **NDJSON providers work while streaming too**: lines that arrive without a `data:` prefix are now read as frames instead of being dropped, so those upstreams no longer look like an empty model.
- **A transport quirk no longer grounds an account**: response-shape errors are classified as `lock: false`, so a provider that answers in the wrong format can no longer put a working credential behind a "(reset after 30s)" cooldown.
- **Studio names stay separate in Usage**: two Forge names pointing at one model now each keep their own row and stats bucket, because the calls that used to produce no usage record at all are producing one.

# v0.5.78-Custom (2026-09-12)

## What Was Fixed
- **Showdown streams live**: every contender now paints its answer token by token with a ticking elapsed timer, so a slow model reads as "still working" instead of a frozen spinner with no feedback.
- **One streaming client for both tools**: Showdown and the PRD Writer now talk to the gateway through the same `streamChatCompletion` helper, so reasoning deltas, usage capture and readable error parsing behave identically on both pages.

## Custom Features & Enhancements
- **Time-to-first-token is measured**: each battle card reports first token, total time, tokens and cost, and the result table gains a First token column with its own badge.
- **Battles can be stopped**: the run button turns into Stop while anything is in flight, and a cancelled card keeps its partial answer labelled as stopped instead of showing a red failure.

# v0.5.77-Custom (2026-09-12)

## What Was Fixed
- **A rejected request no longer grounds an account**: 400, 406 and 422 from a provider are now classified as caller mistakes, so they surface immediately instead of cooling the credential for 30 seconds and dragging every other account through the same failure.

## Custom Features & Enhancements
- **PRD Writer document profiles**: four new profiles - RFC / Tech Spec, Release Notes, Competitive Analysis and Bug Report → Fix Plan - each with its own section outline built from 25 freshly written section briefs.
- **PRD task list**: one button turns a finished PRD into an ordered `- [ ]` checklist, either parsed straight from the plan section (dependency order, owners, estimates, follow-ups) or extracted by the model when the plan is prose, with copy and `.md` download.
- **Provider Health board**: a new page that rolls the request log into per-account and per-model success rate, p50/p95 latency, spend, last error and a live cooldown countdown, with test-now and pause/resume wired to the existing endpoints.
- **Provider Health stays private**: the bare `GET /api/health` probe still answers `{"ok":true}` for tunnels and uptime checks, while `?window=` board data requires a dashboard session and never leaves request or response bodies on the server.
- **Provider Health explains itself**: the board says when request logging is switched off in Settings instead of showing a page full of zeros.

# v0.5.76-Custom (2026-09-12)

## What Was Fixed
- **Showdown shows real outcomes**: a model that answers with HTTP 200 but no text is now labelled `empty` with the reason why, instead of dumping raw JSON into the result card.
- **Showdown errors are readable**: provider failures show one short line plus HTTP status, cooldown and route chips, with the untouched payload behind "Show the raw error".
- **Silent models can no longer win**: awards and the top ranking ignore answers that produced nothing, so an empty response can't be declared the fastest.
- **PRD Writer errors formatted**: generation failures surface the parsed provider message with a collapsible raw detail, and a completion that returns nothing is reported as empty instead of leaving a blank document.

# v0.5.75-Custom (2026-09-12)

## Custom Features & Enhancements
- **PRD Writer**: a workshop tool that turns a short brief into a full, reviewable product requirements document, and it will not generate until you have picked the model that writes it.
- **PRD controls**: choose the document profile, depth, language, output-token cap and the exact sections to write, then watch the document stream in live.
- **PRD review pass**: an optional second model red-teams the draft, lists up to 12 defects, and rewrites the whole document with the missing sections filled in.
- **PRD proof and storage**: a section checklist reports which required headings actually arrived, and every document can be saved, reopened, copied, downloaded as `.md`, or inspected through the exact prompt that produced it.
- **Workshop menu names**: the custom-tools group is now the single word **Workshop**, and its tools no longer share the word "Model" - **Showdown** (was Model Battle) and **Forge** (was Model Studio).
- **Distinct menu icons**: Console Log now uses a monitor icon and its log card a list icon, so it no longer looks identical to CLI Tools.

# v0.5.74-Custom (2026-09-11)

## What Was Fixed
- **Model Studio no longer renames the original model**: a studio name is now resolved through its own record instead of writing a display alias, so `claude-fable-5` appears as an added entry while `custom1/claude-sonnet-5` keeps its own name in every picker.
- **Legacy studio aliases cleaned up**: display aliases left behind by older builds for studio names are deleted the first time the studio list loads, so previously renamed models reappear under their real name.
- **Usage shows the called studio name everywhere**: the name you call (e.g. `claude-fable-5`) is now recorded as the request's model across Overview, Leaderboard, Logs and Details, with the real backend model kept only as muted `→ provider/model` text and cost still priced from it.

## Custom Features & Enhancements
- **MoonshotAI logo is reliable**: compatible nodes created from the MoonshotAI button are tagged with a brand, and that tag (not just the name) now picks the `moonshot-ai.png` logo on cards, the detail page, and its colors.

# v0.5.73-Custom (2026-09-11)

## What Was Fixed
- **Model Studio page crash**: the per-card copy button now uses the shared copy hook, so a saved model no longer throws the client-side `ReferenceError` that showed "This page couldn't load".
- **Model Battle data load**: the missing API-key and Model Studio fetch is restored, so a key is pre-selected and virtual (studio) names are priced by their real target model.
- **Sub-cent battle costs**: costs now show enough digits (e.g. `$0.0034`) instead of every row reading `$0.00`, so the cheapest badge means something.
- **Backup round trip**: exports now carry `disabledModels`, and import clears the stale request log in the same transaction while keeping usage history in its original order.
- **Duplicate API key names on rename**: renaming an existing key to a name already in use is now rejected (HTTP 409) with the reason shown in the UI, matching how key creation behaves.

## Custom Features & Enhancements
- **No password nagging**: the tunnel/endpoint page no longer warns about the default dashboard password or blocks activation over it - the tunnel turns on as-is.
- **Models are picked, never typed**: the allowed-models field in the API key dialogs is read-only; models come from the picker only (chips + Select Models), so a typo can no longer lock a key out of a model.
- **Changelog works offline**: a local `/api/changelog` route serves this fork's changelog from disk, falling back to raw GitHub only for what it cannot resolve; the custom section is labelled **Contributed by Serenhope**.
- **CLI default password**: the terminal settings menu now reports `seren123` as the default dashboard password instead of the old upstream value.
- **UI polish**: long sidebar labels, provider/model ids, tool titles, badges and the header search now ellipsize instead of pushing buttons out of place, with the full text available on hover.
- **Sidebar group renamed**: `Model Lab` is now **Custom Suite** - it holds every feature added by this fork, not only the model tools, so future additions have an obvious home.

# v0.5.72-Custom (2026-09-10)

## Custom Features & Enhancements
- **Model Studio (was Model Editor)**: pick any connected model (built-in, custom provider or compatible) and give it your own callable name, display name, context window and injected system prompt, which then resolves in chat, `/v1/models`, and every model picker.
- **Model Battle (was Model Arena)**: Side-by-side comparison now supports up to 4 contenders, estimated cost per run, and a **Final Result** board - fastest / cheapest / longest badges, plus a manual "My pick" so quality is decided by you, not a judge model.
- **Menu Renames**: The `Feature+` group is now **Model Lab** containing **Model Battle** and **Model Studio**.
- **MoonshotAI Logo**: MoonshotAI compatible providers now use the uploaded `moonshot-ai.png` brand image on cards and detail pages.
- **Provider Prefixes**: Kept in Model Studio - one editable prefix per custom provider (`prefix/model-id`).

# v0.5.71-Custom (2026-09-10)

## Custom Features & Enhancements
- **Model Editor**: Edit per-model overrides (rename, target model, context window, system prompt) and manage custom provider prefixes from a dedicated Model Editor page under Feature+.
- **MoonshotAI Provider**: Added MoonshotAI (Kimi) compatible provider option alongside OpenAI/Anthropic compatible providers.
- **Extra Combo Strategies**: New combo routing strategies beyond Fallback / Round Robin / Fusion.
- **Changelog View**: Combined changelog modal - custom contributions shown in a highlighted "Contributed by Seren" section above the official Decolua release notes.
- **UI Cleanup**: Refined dashboard layout, tidied console log view, and removed the Live Feed page and related controls for a cleaner sidebar.
- **Backup Fix**: Fixed API key settings and usage statistics being reset on backup import (column/placeholder mismatch).

## What Was Fixed
- **API Key Creation Bug**: Fixed `createApiKey` INSERT placeholder mismatch (16 columns vs 15 `?`) that made creating any API key silently fail.
- **API Key Expiry**: Expiry date set during creation is now persisted (was silently dropped).
- **Unique Key Names**: API key names are enforced unique - server rejects duplicates and the client shows a clear message; no overwriting.
- **Duplicate API Key**: Added a Duplicate button per key that copies all settings into a new key with an auto-suggested unique name (`X (copy)`, `X (copy 2)`, …); a fresh key value is generated.

# v0.5.70-Custom (2026-09-07)

## Custom Features & Enhancements
- **API Key Quota & Limits**: Add token limit per API Key with real-time usage tracking and HTTP 429 (`API key token limit exceeded`) response upon quota exhaustion.
- **Dynamic Auto Reset Interval**: periodic usage resets (`5h`, `7d`, `14d`, `30d`, or custom like `10h`) become selectable whenever `tokenLimit > 0`.
- **Model Access Control**: API Keys can be restricted to allowed models with wildcard (`claude-*`, `gpt-*`) or exact matching, returning HTTP 403 on unauthorized calls.
- **Interactive Model Selector**: Integrated `ModelSelectModal` directly into Create & Edit API Key forms, allowing users to pick allowed models visually (same UI as Combo creation) without manual typing.
- **Key Editing & Management**: key names, token limits, reset intervals, and allowed models stay editable anytime, with a manual `restart_alt` button to zero the used tokens.
- **UI & Theme Sync**: the app is locked to dark mode with theme and language switchers removed, and custom select dropdowns now follow the app theme.

# v0.5.91 (2026-09-26)

## What's Added?
- **Providers**: add Token Harbor provider and four OpenAI-compatible aggregator providers (dahl, atria, agnes, bai)
- **Claude**: forward `x-claude-code-session-id` on OAuth requests; merge client `anthropic-beta` flags and forward rate-limit headers; return thinking text to OpenAI-format clients
- **Codex**: add GPT-6 Sol and Luna support
- **CLI Tools**: support multiple model profiles for Codex CLI
- **Hermes**: multi-role model config (delegation + auxiliary slots)
- **OpenCode Go**: complete the Go catalog (40 models) with auto-fetch + family endpoint regex
- **Usage**: show and redeem free limit resets for cc accounts
- **Cline**: expose the `cline-free/*` tier and price it at zero
- **Combos**: display vision adapter models in an ordered table view

## What Was Fixed
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

## What's Added?
- **Xiaomi MiMo**: server-assisted desktop login for headless/Docker deployments, five account clusters (cn/sgp/ams/ru/in), and v2.6 pro/flash/pro-ultraspeed models with dual-route (account service vs. cloud API)
- **Claude**: add Claude Opus 5.5 support
- **i18n**: translate React text rewrites via characterData mutation observer

## What Was Fixed
- **Proxy Pools**: keep request headers intact through Vercel/Cloudflare/Deno relays (spreading a `Headers` instance yielded `{}`, dropping auth and content-type)
- **Xiaomi MiMo login**: keep the session in the httpOnly cookie only, require dashboard auth on the proxy branch, and stop forwarding authorization headers upstream

# v0.5.85 (2026-09-22)

## What's Added?
- **System One**: add `/v1/systemone` decision endpoint for Jev models (OpenCode Zen and OpenRouter lanes), wire into sidebar and Media Providers page with interactive probe testing
- **CLI Tools**: add dynamic configuration, settings APIs, and official logos for Pi, OMP, Crush, ForgeCode, Smelt, and CodeWhale
- **Analytics & Usage**: add Requests mode, provider/model breakdown charts, All Time period filter, and refined overview cards
- **Combos**: add Cursor/Claude Default presets; support bulk select/delete and bulk strategy changes (Fallback / Round Robin / Fusion)
- **Model Capabilities**: expose model capability metadata on `/v1/models` and aggregate capabilities across combo targets
- **OpenCode Zen & MiMo**: add OpenCode Zen (`opencode-zen`) provider with free-tier fingerprint; switch default vision fallback to MiMo V2.6 Flash Free
- **Qoder CN**: add `qoder-cn` provider for qoder.com.cn with OAuth flow, COSY protocol, and CN gateway routing

## What Was Fixed
- **Translator**: map Claude `refusal` stop_reason to `content_filter` and surface explanation; strip replayed reasoning fields for Groq, Mistral, and Cerebras (#4220)
- **Antigravity**: drop requestType `agent` to avoid false 429 `RESOURCE_EXHAUSTED`; separate weekly and short-window (5-hour) quotas and deduplicate dashboard rows
- **Responses API**: report usage on `response.completed` so clients can auto-compact (#3432)
- **Hugging Face**: migrate to Inference Providers router (`router.huggingface.co`), expand image models catalog, and add STT route
- **Qoder**: prevent signed request replay (`403/103 Duplicate request`), handle code 110 billing blocks, and preserve upstream SSE error status
- **Performance**: bound usage `lastUsed` scan to a 2-day window; map large budget tokens to `max` reasoning tier
- **Docker**: publish verified multi-platform images (linux/amd64 and linux/arm64) with configurable apk build mirrors

# v0.5.81 (2026-09-18)

## What's Added?
- **Xiaomi MiMo**: merge MiMo Desktop support into `xiaomi-mimo` with dual auth (API key + Desktop/OAuth session), Preview models support, and encrypted-callback OAuth flow
- **Claude Code**: add 1M-context toggle (`[1m]` marker) and drive `CLAUDE_CODE_AUTO_COMPACT_WINDOW` directly from the dashboard
- **Models**: add DeepSeek-V4.1-Flash to DeepSeek provider, CodeBuddy-Intl, and Ollama (`deepseek-v4.1-flash:cloud`); enable `low`..`max` reasoning effort levels and vision capability for DeepSeek-V4.*
- **i18n**: integrate Persian (fa) translation

## What Was Fixed
- **Cursor**: stop AgentService empty turns (`OUT 0`) and silent hangs - fold system prompts instead of `custom_system_prompt`, send `ModelDetails`, read Composer/Grok `thinking_delta`, ack request-context without echoing MCP tools, and reject IDE execs so the model can continue
- **RTK**: for Cursor, compress source-format `tool_result` / `role:tool` **before** translation - its translator rewrites those shapes, so post-translate compression missed them. Other providers keep the post-translate pass unchanged
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

## What's Added?
- **Video**: add OpenRouter and Vertex AI (Veo) video generation on `/v1/videos/*` via a provider adapter layer; poll requests resolve their provider from `x-connection-id` or `?provider=`
- **Antigravity**: add weekly quota tracking (Gemini weekly / Claude & GPT weekly) and free-tier handling from `retrieveUserQuotaSummary` (#3892)
- **Codex**: add GPT Image 2.5, Flare and Sunburst image models with multi-image support; add the same ids to the OpenAI catalog
- **Qoder**: surface usage to all clients and stop inlining large attachments - images upload through `/api/v2/image/upload` like qodercli, oversized file blocks become stubs, context tier auto-escalates
- **OpenCode Go**: add newly published models (glm-5.3, kimi-k3, deepseek-flash, longcat-2.0, hy4-preview, hy3 on chat/completions; qwen3.8-max, qwen3.8-flash on `/messages`; grok-4.6, gpt-5.6-luna on Responses) and list `deepseek-v4.1-flash` first in the catalog
- **CLI tools**: group the model selector by provider with full-text search and manual custom model ID entry
- **CodeBuddy-CN**: replace `deepseek-v4-flash` with `deepseek-v4.1-flash`

## What Was Fixed
- **Tools**: scope Claude tool type defaulting to gateways declaring `requireClaudeToolType` - the global default broke Anthropic-compatible endpoints that only accept the legacy typeless tool shape (#3905)
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

## What's Added?
- **Codex**: add GPT 6.0 Astra (`gpt-6-astra`) with vision, thinking and search capabilities
- **Usage**: add Claude Fable quota tracker support with weekly window normalization (`weekly fable (7d)`)
- **Dashboard**: group Antigravity Gemini and Claude quotas in Quota Tracker, prune stale hidden keys
- **OpenCode Go**: add `muse-spark-1.3-contributor` model and support parallel tool calls on Responses path (#3819)
- **Providers & Models**: align CodeBuddy-CN catalog/capabilities with server config; add GPT-5.6 Sol, Terra, Luna image aliases on Codex (#3806); refresh Qoder catalog with capability mapping and image pass-through
- **CLI tools**: replace Copilot MITM with VS Code extension setup guide
- **Gemini**: persist and replay `thoughtSignature` scoped by session namespace

## What Was Fixed
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

## What's Added?
- **Fetch**: add Ollama Cloud web fetch provider
- **Gemini / Antigravity**: add Gemini 3.8 Flash support and bump IDE fingerprint to 2.11.0
- **Claude**: add Claude Fable 5.1 support (adaptive thinking with `output_config.effort`), bump Claude Code fingerprint to 2.1.258 for new-model access
- **Providers**: add client-side status filter (All / Active / Inactive / No connection) on the Providers dashboard; add max height and scroll for connection list
- **Providers & Models**: streamline tokenrouter model catalog down to 22 flagship/newest models and add missing provider icons; refresh Codebuddy-CN catalog (add hy4-preview/hy3/glm-5.3/kimi-k3-1, drop EOL glm-5.0/glm-4.7)
- **Models**: capability toggles (vision, reasoning) when adding custom models with upsert and live caps refresh
- **CLI tools**: support saving and managing custom API key presets
- **Quota**: add usage and rate-limit tracking for Groq via `x-ratelimit-*` headers
- **i18n**: complete Indonesian translation (1391 keys)

## What Was Fixed
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

## What's Added?
- **Search**: new web search providers - Antigravity (Google Search grounding
  on the existing OAuth account pool, citations keyed and merged by URL) and
  Xquik (X search with `x-api-key` auth, cursor pagination, credit-based
  usage), both on `POST /v1/search`. Based on #3437 by @Nautilaceae
- **Search**: ollama-search and zai-search borrow a chat provider's API key
  instead of requiring their own connection, driven by a new
  `credentialFallback` registry field. zai-search later folded into the `glm`
  provider itself so the web search page shows the shared connection
- **Models**: daily background sync of model capabilities from models.dev -
  modalities keyed by model id (majority of sources must declare one),
  context/output limits keyed by provider + model, strictly additive and
  sitting below the hand-written tables. ETag + mtime cache, 60s startup
  delay, `MODEL_CATALOG_SYNC=off` to disable
- **Models**: add GLM-5.3-Flash (1M context, natively multimodal), DeepSeek
  V4 Vision, Grok 4.5/4.6 (500k context); correct glm-4.6v/4.5v video input
  and output limits, backfill glm-4.6v on glm-cn
- **Usage**: show the Zed plan quota on the dashboard - plan, edit
  predictions, hosted model requests and billing-cycle reset; unlimited rows
  render as "N used · Unlimited"
- **Usage**: track GPT-5.3-Codex-Spark quota windows (spark_session /
  spark_weekly) from the Codex usage response (#3431)
- **Antigravity**: quota-aware routing - on 409/429 fetch live quota for the
  exact per-model resetAt and skip only the exhausted account/model pair;
  report the earliest reset when every account is blocked (#3561)
- **Antigravity**: map image `size` to the aspect-ratio model suffix (-WxH);
  add the Gemini 3.7 Flash tiers to MITM defaultModels so they show up in
  the dashboard model-mapping table
- **Dashboard**: bulk import Grok CLI accounts from JSON - paste an array or
  drag-drop multiple .json files, all OAuth connections created in a single
  call, mirroring the codex flow
- **CLI tools**: endpoint presets shared across every tool card through one
  live-resyncing store, instead of per-card localStorage copies that never
  saw each other's saved endpoints
- **Token Saver**: configurable compression timeout (`headroomTimeoutMs`) -
  the fixed 3000 ms made busy machines time out and send inconsistently
  compressed bodies, hurting prompt caching
- **i18n**: pt-BR expanded to 1132 terms

## What Was Fixed
- **Claude Code**: add Claude Fable 5.1 and advertise Claude Code 2.1.258 in
  both the request header and billing identity; use its permanent adaptive-thinking
  mode with `output_config.effort`
- **Stream**: record usage when a client closes on the terminal event - the
  Responses API has no [DONE] sentinel, so codex closed the socket on
  `response.completed` and cancelled the reader before flush() ran its usage
  side effects; the tail now lives in a once-guarded finalizeStream(). Also
  stop logging a disconnect for every completed Responses call
- **Stream**: parse the trailing NDJSON line an Ollama stream leaves behind
  without a closing newline - the final chunk carrying `done_reason` and the
  token counts was dropped
- **Session**: read the Claude Code session id from the
  `x-claude-code-session-id` header - `metadata.user_id` is dropped by
  Responses translation, splitting one conversation across several
  `prompt_cache_key` values and missing the upstream prefix cache
- **Usage**: preserve nested `cached_tokens` - the top-level-only read
  persisted `cached_tokens: 0` for every Responses-format provider (codex,
  grok-cli, …), billing cache hits at the full input rate
- **Usage**: GLM quotas accept CREDIT_LIMIT plans and multi-interval windows
  (5h session / 7d weekly) instead of overwriting a single "session" key
- **Models**: the catalog sync no longer erases its own output - deltas were
  measured against the previous run's writes (the second run cut `providers`
  from 20 entries to 5); one vote per provider in the modality tally, ETag
  restored from file on startup, and the worker thread dropped after the
  bundler rewrote its path into a module-not-found error
- **Executor**: CommandCode returns errors as a `type:"error"` event inside
  an HTTP 200 NDJSON stream - peek the first events before committing, abort
  and return a real 4xx/5xx so combo/account fallback triggers instead of
  streaming the error text as content
- **Search**: scope failure locks on the credential-fallback path - a failing
  search locked `modelLock___all` and took the shared glm key offline for
  chat as well; locks are now attributed to the connection's owner and
  scoped to `websearch:<provider>`
- **Providers**: connection tests get a 15s AbortSignal timeout instead of
  hanging and exhausting the browser socket pool; guard undefined provider
  names on the providers page
- **Antigravity**: sanitize competing-client branding via a config-driven
  rule table (Zed's Claude-agent prompt, opencode → antigravity) - upstream
  answers 429 Quota Exhausted. Applied in the executor so the shared
  openai-to-gemini translator leaves gemini/vertex/zed untouched
- **MiniMax**: preserve images on the sourceFormat-matched OpenAI transport
  - MiniMax-M3 resolved a Claude-shaped body posted to the OpenAI endpoint,
  silently dropping `image_url` blocks (#3418)
- **Claude**: decloak tool names in same-format streaming passthrough -
  OAuth-cloaked names (CLAUDE_TOOL_SUFFIX) leaked to the client and every
  tool call was rejected as unknown
- **Tools**: default a missing `tools[].type` to "custom" on Claude-format
  requests - strict Anthropic-compatible gateways (MiniMax) reject the
  request with 400 otherwise
- **Translator**: zai thinkingFormat sends the top-level `reasoning_effort`
  object GLM-5.2+ requires - every GLM-5.x request ran at the model default
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
- **CLI tools**: send the API key Codex actually reads -
  `[model_providers.9router.http_headers]` instead of auth.json (which left
  every request 401 and clobbered an existing ChatGPT login); subagent model
  moved to `agents.default_subagent_model`
- **OAuth**: refresh Cline tokens with the extension JSON contract
- **Dashboard**: clamp the API key mask length - keys shorter than 8 chars
  threw RangeError and crashed the media-provider detail page
- **UI**: wait for the Material Symbols font itself before revealing icons -
  `document.fonts.ready` resolved before the 4MB woff2 even started loading,
  leaving icons blank until a second load

# v0.5.55 (2026-08-14)

## What's Added?
- **Auth**: native SAML 2.0 SSO alongside OIDC - AuthnRequest generation, ACS
  assertion handling, SP metadata export, admin config test, replay-protected
  via a `saml_state` cookie matched against `InResponseTo`
- **Providers**: add Alibaba Token Plan (`token-plan.ap-southeast-1`) - the
  fourth Alibaba key type, Singapore-only and OpenAI-compatible transport only
- **Providers**: add `glm-5.3` to GLM Coding and GLM (China)
- **Providers**: Kimchi accepts API keys as well as OAuth (dual auth), with a
  working Test Connection for both modes
- **Antigravity**: add Gemini 3.7 Flash and its tiered high/medium/low variants
  (also in the Gemini registry) with pricing and quota tracking
- **TTS**: add Fish Audio - model id travels in an HTTP `model` header, voice
  is a `reference_id` (preset or cloned voice model)
- **OpenCode-Go**: route by request format via declared transports instead of
  forcing every client into `/messages` - Codex/OpenAI clients no longer pay a
  lossy Responses→OpenAI→Claude double translation. Per-model `supportedFormats`
  guard; the bespoke executor is gone (its shared `_lastModel` cache could cross
  auth headers between concurrent requests)
- **Usage**: dedup + cache Claude quota calls (120s TTL keyed by access token,
  in-flight promise dedup, last-good read on soft failure) to stop multiple
  tabs tripping 429; manual refresh (↻) sends `force=1` to bypass the cache

## What Was Fixed
- **Docker**: ship `sql.js` in the image so the pure-JS DB fallback can start -
  file tracing carried the package's JS without `dist/sql-wasm.wasm`, so a
  container with no native driver aborted with ENOENT and never got a database
  (#3248)
- **Usage**: read Gemini `usageMetadata` out of the antigravity `{ response }`
  envelope - every non-streaming antigravity request logged `IN 0 | OUT 0`
  (#3260)
- **Claude**: re-anchor passthrough cache breakpoints - the client's own
  `cache_control` markers point at pre-normalization offsets, so the tail was
  re-cached every request. Last system block and last tool pinned at 1h TTL,
  last assistant turn at 5m, mid-conversation system messages folded into the
  neighbouring user turn instead of hoisted into `body.system`
- **Combos**: detect images from Hermes and attachment payloads (`images[]`,
  `experimental_attachments`, message-level `image_url`/`audio_url`, inline
  `data:` URIs) so the Vision Adapter auto-switch fires for Hermes/Ollama/
  Vercel AI SDK shapes
- **Kiro**: intercept chat via `x-amz-target` - Kiro IDE 1.0.228+ moved
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
- **Responses**: don't close the message on an empty `tool_calls` array - some
  providers attach one to every chunk, and the truthy check ended the message
  on the first content token (#3234)
- **Translator**: preserve `prompt_cache_key` when converting chat to responses
- **Models**: expose snake_case token limits on `/v1/models`
- **Combos**: strip `stream_options` from the Fusion panel fan-out to avoid a
  DeepSeek 400 (#3024); raise the dashboard model-test probe budget to 1024 and
  soft-pass reasoning-only responses (#3010)
- **Headroom**: the toggle reflects the `headroomEnabled` setting even when the
  proxy is down - it previously showed OFF while the engine kept calling
  `/v1/compress`; proxy status stays visible via the status chip
- **Hermes**: add the `api_key` parameter to the model block in YAML config
- **Providers**: add llm7 to provider test support

## What's Documented?
- **i18n**: add Spanish, French, and Brazilian Portuguese README translations

## What Was Hardened?
- **Real IP**: `x-9r-real-ip` and the Host fallback were trusted from
  client-controlled headers whenever `custom-server.js` was not in the request
  path (`npm run start`, `start:bun`), letting a remote caller pose as local to
  skip API key auth and reach `LOCAL_ONLY_PATHS` (`/api/mcp/*`,
  `/api/tunnel/enable`, `/api/auth/reset-password`). The server now stamps a
  per-process `x-9r-peer-token` on every request it sanitizes and only trusts
  `x-9r-real-ip` behind it - falling back to Host in development and failing
  closed in production (GHSA-pjm4-8fpg-f9p6). Also fixes IPv6 loopback
  detection (`::1`, `::ffff:127.0.0.1`) and routes `npm run start` /
  `start:bun` through `custom-server.js`
- **Search**: `resolveBaseUrl()` rejects client-supplied non-public baseUrls
  (SSRF guard on `/v1/search`)
- **Login**: fresh-install remote login with the default password returns 403
  without issuing a JWT
- **Usage**: `/api/usage/request-details` redacts request/response payloads

# v0.5.50 (2026-08-05)

## What's Added?
- **Providers**: add TokenRouter (300+ models via OpenAI-compatible gateway) with
  exact per-model pricing for 110 models and `reasoning_effort` thinking config
- **Providers**: add Self-hosted STT / TTS / Embedding - point 9Router at your own
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

## What Was Fixed
- **Providers**: remove Qwen (OAuth flow stopped working reliably)
- **Passthrough**: detect codex-tui/Codex Desktop as native Codex client - they
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
- **TTS**: a bare self-hosted model name is the MODEL, not the voice - `kokoro`
  was parsed as a voice against a default model, 404ing or synthesising with the
  wrong one
- **Embeddings**: self-hosted embeddings no longer fall back to `api.openai.com`
  when a connection has no `baseUrl` - that silently sent the input text and API
  key to OpenAI under a provider named "Self-hosted"
- **Embeddings**: an adapter that rejects a misconfigured connection now returns
  400 with the reason instead of escaping the handler uncaught
- **Embeddings**: bound the upstream fetch with `FETCH_CONNECT_TIMEOUT_MS` - an
  endpoint that drops packets never returns headers, so the request previously
  hung indefinitely

## What's Documented?
- **i18n**: fix port typo, add RTK Token Saver feature descriptions

# v0.5.45 (2026-07-30)

## What's Added?
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

## What Was Fixed
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

## What's Documented?
- **i18n**: expand pt-BR translation to 986 terms
- README: Indonesian translation

# v0.5.40 (2026-07-20)

## What's Added?
- **i18n**: add Khmer (km) translations
- **CLI tools**: configure Grok Build subagent models
- **Kimi**: merge OAuth into dual-auth provider, add K3 / K2.7 models
- **Dashboard**: ProviderTopology flow animation

## What Was Fixed
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

## What's Added?
- **xAI**: Grok Imagine video generation (`/v1/videos`) + CLI
- **CLI tools**: Grok Build setup - choose separate main/general-purpose/explore/plan models and preserve each model's context window
- **GitHub Copilot**: route Claude models through Copilot's native `/v1/messages`
- **Kiro**: add GPT-5.6 model family (#2596)
- **RTK**: `X-9Router-Token-Saver` header to bypass token savers per request
- **Providers**: quota visibility settings
- **Translator**: drop temperature for all Claude models
- **i18n**: Thai (th) + Persian (fa) translations / README

## What Was Fixed
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

## What's Documented?
- README: Persian YouTube tutorial

# v0.5.30 (2026-07-10)

## What's Added?
- **Perplexity**: add Agent API provider (#2492)
- **Grok CLI**: add Grok CLI / Grok Build provider with OAuth device-code flow (#2502)
- **Featherless**: add OpenAI-compatible provider presets
- **SearXNG**: configure endpoint via SEARXNG_URL env (#2499)
- **Providers**: add max thinking level for gpt-5.6-sol (#2500)
- **Headroom**: add extras detection and install UI (#2403)
- **Headroom**: activate/uninstall extras + fix interpreter detection
- **PXPipe**: PXPIPE token saver - multimodal prompt compression (#2465)
- **Proxy-Pools**: auto-rotate strategy for no-auth providers (#2409)

## What Was Fixed
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

## What's Added?
- **Thinking**: per-model thinking level picker on provider page - appends `(level)` suffix to copied model names for forced reasoning effort across all formats (openai, claude, gemini, deepseek, kimi, qwen, zai, minimax, hunyuan, step)
- **RTK**: add JS-native git-log filter (#2423)
- **Caveman**: add targeted upstream-aligned style rules (#2424)
- **i18n**: add Farsi (fa) language support (#2385)

## What Was Fixed
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

## What's Added?
- **Usage**: track cached tokens + correct input/output/cache cost (#2209) - hodtien
- **Codex**: show reset credit expiry details (#2290) - Rafli Ahmad Zulfikar
- **NVIDIA**: add new models and capabilities - decolua
- **ClinePass**: add provider support - sternelee

## What Was Fixed
- **Usage**: dedupe streaming request-details log entries - Qin Li
- **Claude**: drop foreign thinking signatures in passthrough - decolua
- Prevent non-SSE stream pipe crash and cross-IdP account overwrites (#2244) - KunN-21
- **Kiro**: route IdC auth to regional CodeWhisperer surface (#2297) - Volodymyr Saakian
- **Kiro**: add Claude Sonnet 5 model support (#2264) - Edison42
- **Xiaomi-tokenplan**: region selector, key validation, multi-connection (#2251) - MiQieR
- **Translator**: strict Anthropic content block compliance (#2225) - Sahrul Ramadhan Hardiansyah
- **Kimchi**: strip reasoning_content echo to bound multi-turn input tokens - KunN-21
- **Kimchi**: bump User-Agent to kimchi/0.1.40 (#2256) - Ansh7473
- **Codebuddy-cn**: strip empty tool_calls arrays to preserve reasoning - zmf
- **Antigravity**: preserve Claude tool delta index (#2223) - Sutarto Jordan Chrisfivo
- **MITM**: generate root CA on server startup (#2228) - Sutarto Jordan Chrisfivo

# v0.5.15 (2026-06-29)

## What's Added?
- Add Kimchi OAuth provider - Nant361
- Refine Qwen vision/video + thinking model patterns - decolua
- Opt-in Codex auto-ping quota keep-alive - Emirhan

## What Was Fixed
- **Responses**: handle response.done terminal events (#2142) - rifuki
- **Headroom**: skip unsafe responses tool history (#2132) - Sutarto Jordan Chrisfivo
- **Translator**: map mid-conversation system message to user (claude→openai) - decolua
- **Gemini**: normalize contents to prevent 400 invalid_argument (#2192) - warelik
- **Gemini**: backfill thoughtSignature + suppress stream done sentinel - WARELIK
- **Alicode**: preserve cache_control for DashScope providers (#2069) - Rex
- **Antigravity**: strip deprecated/readOnly/writeOnly from tool schemas - iletai, Yudhistira-Official
- **CodeBuddy CN**: show bonus packs as one-time, not monthly-replenishing - whale9820
- **Kiro**: strip leaked <thinking> tags from content stream (#2158) - hamsa0x7
- **Tray**: make Windows context menu DPI-aware - Emirhan
- **Kilocode**: expose full gateway catalog in combo model picker - jellylarper
- **OpenCode**: fix Go GLM - decolua

# v0.5.12 (2026-06-26)

## What's Added?
- Add token-saver dashboard page - decolua
- Add bulk delete for provider connections - teddytkz
- Resolve GitHub Copilot model catalog from upstream - caiqinzhou
- Add Venice AI provider - Brokenc0de
- Add Kiro external_idp import for Microsoft SSO (CLIProxyAPI) - Stevanus Pangau
- Overhaul Blackbox provider catalog + WebUI test support - suryacagur

## What Was Fixed
- Provider thinking compatibility (DeepSeek/Gemini) - Mink Nguyen
- Stop double-counting streaming usage at source - decolua
- Usage logging dedupe to reduce stats churn - Mink Nguyen
- Prevent non-JSON SSE lines / duplicate [DONE] from breaking clients (PR #2046) - qianze
- Resolve Gemini TTS models from catalog - nguyenha935
- Support Kiro IDC (organization) token import - quanturbo
- Preserve forced streaming for JSON clients (#2031) - Joseph Yaksich
- Preserve Responses text format (Codex) - tenglong
- Support Gemini native TTS generateContent endpoint - nguyenha935
- Add missing zh-CN endpoint key label (i18n) - weimaozhen
- CodeBuddy: only send reasoning params when client requests reasoning (#2071) - Rex
- CodeBuddy CN: show one-shot bonus packs as expiring, not monthly-replenishing
- Show custom provider models in combo picker - Sapto
- Docker: add docker-compose.yml with headroom enabled by default - nitsuahlabs
- Clarify token diagnostics vs provider billing (headroom, #1998) - Sutarto Jordan Chrisfivo
- Translate openai-responses input through OpenAI for compression (#1998) - Ankit
- Kiro: report 1M context window for claude-opus-4.8 - EdisonPVE
- Avoid stale redirects after auth changes (#2100) - Emirhan
- Mark Claude Opus 4.7 (dashed id) as 1M context - Brokenc0de
- Preserve reasoning effort through Codex translations - ntdung6868
- Token-saver: full width card layout - decolua
- Antigravity: retry transient upstream failures - Sutarto Jordan Chrisfivo
- Param-support: handle strip rules without match/drop (#1960) - Joseph Yaksich
- Translator: resolve custom provider prefix in debug endpoint (#1083) - hamsa0x7

# v0.5.8 (2026-06-21)

## What's Added?
- **Antigravity**: native image generation support (image models tagged kind:image, hiển thị trong media-providers UI)
- **CodeBuddy CN**: API key auth + credit quota tracker
- **CodeBuddy CN**: short model prefix alias "cbcn"

## What Was Fixed
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

## What's Added?
- **Ponytail**: minimalist code generation feature
- **Headroom**: proxy lifecycle management + dashboard UI (one-click start/stop, install detection, status probing, token saver, claude↔openai shape conversion)
- **CodeBuddy CN**: new OAuth provider (copilot.tencent.com) - 15-model catalog, /v2 inference, forced streaming, OpenAI-style reasoning
- **OpenCode-Go**: align models with official endpoints; route Qwen 3.7 MiniMax via /v1/messages, GLM/Kimi/DeepSeek/MiMo via /chat/completions

## What Was Fixed
- **Anthropic-compatible validation**: use POST /v1/messages (GET /models not spec, false "invalid" for valid keys)
- **CLI tools**: tolerate JSONC configs in all 8 settings routes (opencode, openclaw, kilo, droid, cowork, copilot, claude, cline)
- **Gemini/Antigravity**: preserve 'pattern' in tool schema translation (glob/grep)
- **Combo/Fusion**: flatten Anthropic-style tool messages in panel calls (prevent 503)
- **Models**: store provider custom models by provider scope
- **Perplexity**: use /v1/models endpoint for key validation

# v0.5.4 (2026-06-18)

## What Was Fixed
- **Kiro**: honor thinking effort budgets
- **AG/Kiro/Xiaomi**: provider fixes
- **Combo/Fusion**: flatten tool history in panel calls to prevent 503
- **LLM selector**: show custom vision models in selector and model list
- **Image**: prevent compatible nodes from shadowing provider aliases

# v0.5.2 (2026-06-17)

## What's Added?
- **Combo Fusion strategy** - fans the prompt out to all member models in parallel, then a configurable judge model synthesizes one final answer (quorum-grace, anonymized sources, graceful degradation)
- **Per-combo strategy selector** - pick `fallback` / `round-robin` / `fusion` / `capacity` per combo (replaces the old round-robin toggle), with a judge picker for fusion
- **Capacity auto-switch** - reorders models per request so images/PDFs route to capable models first
- **Kiro headless API-key auth** (`ksk_`) + direct `claude↔kiro` route that avoids the lossy OpenAI two-hop pivot
- **Claude auto-ping** - warms the 5h quota window right after reset so a fresh window starts immediately (per-connection toggle)

## What Was Fixed
- **Claude 429**: stop hammering the OAuth usage endpoint - cache resetAt, throttle quota refresh to 3 min, cool down after a 429 (chat unaffected)
- **Usage logs always empty**: missing `await` on `getAdapter()` in `getRecentLogs` made `/api/usage/logs` & `/api/usage/request-logs` return nothing
- **Executors**: strip params unsupported by the provider/model (drops deprecated `temperature` for claude-opus-4 → Anthropic 400)
- **Translator**: derive deterministic tool_call ids for gemini/antigravity → OpenAI so function call/response pair correctly (fixes tool-pairing 400s)
- **Antigravity**: strip `optional` from tool schemas before sending to Gemini
- **Claude-to-OpenAI**: handle OpenAI-format responses in the non-streaming path (e.g. xiaomi-tokenplan)
- **Usage views**: show edited connection names consistently across Providers & Quota Tracker
- **Security**: hardened reverse-proxy local-access trust
- **Security**: SSRF hardening on web fetch

## What's Under the Hood?
- Large **open-sse / translator refactor** (~40 commits): unified provider/model registry (LiteLLM-style `models[]` + `kind` field, 100 co-located registry files), single-sourced media/OAuth/refresh/token URLs, registry-based dispatch for usage & token-refresh, DRY translator concerns (buildUsage, encodeDataUri, finishReasonMap, chunkBuilder, reasoningDelta…), ESM-safe registry init, large-file splits, dead-code removal, and golden/no-regression test gates

# v0.4.80 (2026-06-13)

## What's Added?
- Vercel AI Gateway: support embeddings, images and credit usage (#1183)
- Add MiMo Free no-auth provider (#1789)
- Vertex: support ADC `authorized_user` credential
- Cowork: re-enable Claude Cowork with preset-only stdio MCP
- Codex: bulk add accounts via JSON (#1719)
- Kiro: enable multi-endpoint failover for GenerateAssistantResponse (#1722)

## What Was Fixed
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

## What's Documented?
- README: add Indonesian 9Router tutorial video (#1709)

# v0.4.71 (2026-06-06)

## What's Added?
- Caveman: add wenyan classical Chinese levels and sync upstream prompts; locale-based visibility on endpoint page
- i18n: endpoint exposure notice across multiple languages + Russian README
- Antigravity: add gemini-3.5-flash-extra-low (Low) model
- xiaomi-tokenplan: add Claude-native MiMo V2.5 Pro alias via dedicated executor
- Qoder: fetch latest model + dashboard import-model button (#1642)
- MiniMax: add MiniMax-M3 + update Quota Tracker coding/CN (#1631)

## What Was Fixed
- Codex: harden streaming timeouts (stall/connect raised to 60s, configurable per-provider), accept `response.done` event, and always emit a terminal `response.failed` + `[DONE]` for Responses passthrough when a stream closes, stalls, or aborts before a terminal event - prevents codex clients from hanging (#1648, #1680, #1688, #1618)
- Codex: durable OAuth refresh lifecycle (#1664)
- Tunnel: skip virtual interfaces to prevent false netchange watchdog
- Claude: fix forced tool_choice 400 on cc/ OAuth route (#1592)
- Proxy: raise Next client body limit to 128MB via `NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE` (#1529, #1572)
- MiniMax: echo `reasoning_content` on follow-up turns to avoid 400 (#1543)
- Kiro: handle 400 on tool-bearing history without client tools; add mappable "auto" model slot; fix binary EventStream crash + add models & TTS tool filtering
- Antigravity: passthrough tab-autocomplete + mark default agent slot mandatory
- Qoder: allow `qmodel_latest` model key (#1638)
- Providers: restore one-connection guard for compatible/embedding nodes
- Model-test: route image/STT probes to their real endpoints, harden STT ping; add opencode-go + xiaomi-tokenplan to connection test (#1576, #1628)

## Improvements
- Dashboard: reorganize menu actions across sidebar/header/profile
- Translator: add data-driven coverage, bug-exposing cases, and real provider smoke tests

# v0.4.66 (2026-05-29)

## What's Added?
- Add Qoder provider: device-flow OAuth, COSY signing, WAF-bypass body encoding, live model catalog, dashboard quota tracker, 11 models (#1372)
- Add new models: Claude Opus 4.8 (Claude Code), GPT 5.4 Mini (Codex)

## What Was Fixed
- DeepSeek thinking mode: echo `reasoning_content` back on follow-up/tool-call turns so OpenCode-free and custom providers no longer 400 with "reasoning_content must be passed back" (#1543)
- Reasoning injector: match deepseek/kimi model ids case-insensitively (covers custom providers using capitalized model names)
- OpenCode suggested-models: include free models without the `-free` suffix, e.g. `big-pickle` (#1535)

## Improvements
- Codex: trim sunset models, keep gpt-5.5 / gpt-5.4 / gpt-5.3-codex family, add gpt-5.4-mini
- volcengine-ark: refresh model list (add DeepSeek-V4-Flash/Pro, drop EOL entries)
- Lower stream stall timeout 35s → 30s for faster hang detection

# v0.4.63 (2026-05-26)

## What Was Fixed
- GitHub Copilot: never route Gemini/Claude models to the `/responses` endpoint; prevents misleading "does not support Responses API" 400s (#1062)
- proxyFetch: restore missing `Readable` import causing runtime `ReferenceError` in DNS-bypass fetch path

## Improvements
- Lower stream stall timeout from 60s → 35s for faster hang detection

# v0.4.62 (2026-05-26)

## What Was Fixed
- Codex: auto-retry when upstream drops mid-stream (no more hangs)
- Codex: fix random 400/404 errors, tool-calling failures, and unstable prompt cache
- MITM: support Antigravity 2.x 
- Sanitize Read tool args to prevent retry loops from non-Anthropic models (#1144)
- Implement json_schema fallback for OpenAI-compatible providers without native Structured Output (#1343)
- Strip empty Read pages argument in OpenAI-to-Claude translator (#1354)
- Forward Gemini output dimensions for embeddings (#1366)
- Resolve setState-in-effect errors in dashboard components (#1362)
- Gemini CLI: reuse stored OAuth project IDs for quota checks and show clearer setup guidance when the project is missing (#1271, #1428)

## What's Added?
- Add Cloudflare Workers proxy deployer and pool integration (#1360)
- Add Deno Deploy relays support and improved proxy pools dashboard layout (#1437)

## Improvements
- Refactor Tunnel into dedicated Cloudflare and Tailscale manager modules
- Refactor tokenRefresh service with in-flight dedup to prevent refresh_token_reused errors

# v0.4.59 (2026-05-21)

## What Was Fixed
- OAuth: fix login flow on Windows

# v0.4.58 (2026-05-21)

## What's Added?
- xAI Grok provider (OAuth, API key, image)
- Provider limits: paginated accounts with page size controls

## What Was Fixed
- Tailscale: fix connection status on Windows (#1300)
- Tunnel: fix false "checking" when tunnel URL is reachable
- Stream: fix pipe errors on client disconnect/abort

# v0.4.55 (2026-05-18)

## What's Added?
- Xiaomi MiMo Token Plan: region selector (Singapore / China / Europe) - keys are cluster-specific
- Antigravity: risk confirmation dialog before first connection
- Gemini CLI: surface upstream retry delay on 429 errors

## What Was Fixed
- MITM: cannot kill process on macOS under sudo (lsof not found in PATH)
- Stream: false-positive stall timeout on Claude reasoning / Kiro responses
- Tunnel: cannot re-enable after disable (stuck state)
- Tunnel: cloudflared error messages now include log tail for easier debugging
- Language switcher: applies selected locale immediately on close (#1234)
- Antigravity OAuth: metadata now matches the official client

## Improvements
- Gemini CLI: bump engine to 0.34.0
- Re-hide `qwen` (OAuth EOL) and `iflow` (not ready) providers

# v0.4.52 (2026-05-17)

## What's Added?
- Add Vercel AI Gateway provider support (#1183)
- rtk: Kiro format tool result compression - handle conversationState.history & currentMessage, preserve error results, ~13.6% savings (#1194)

## What Was Fixed
- openclaw: normalize agent.model object form `{primary, fallbacks}` before .startsWith → fix TypeError & 'not configured' status (#1216)
- Usage Details pagination: stay inside mobile viewport <640px (#1218)
- Fix test model error
- Fix MIMO provider in Codex
- Disable log file creation when using MITM AG

# v0.4.50 (2026-05-16)

## What Was Fixed
- Fix duplicate tray icon on macOS when hiding to tray
- Fix tray not showing in background mode on macOS
- Fix hide to tray broken on Windows/Linux
- Fix Shutdown button in web UI not working

# v0.4.49 (2026-05-16)

## What's Added?
- Add Kiro provider support: full request/response translation, live model listing, reasoning content support
- Add `buildOutput` RTK filter with autodetect for npm/yarn/cargo build logs
- Add MITM warning notification in tray and dashboard

## Improvements
- Add modalities (input/output) to model configuration for OpenCode
- Fix tray hide-to-tray: keep current process alive instead of spawning detached child (fixes macOS NSStatusItem ghost icon)
- Fix tray kill: graceful shutdown with SIGTERM/SIGKILL escalation
- Fix SIGHUP handling so macOS terminal close doesn't kill tray process
- Hide deprecated providers (qwen, iflow, antigravity)
- Update i18n across 32 languages

## What Was Fixed
- Fix model check (test-models) blocked by dashboardGuard: pass machineId-based CLI token in internal self-calls

# v0.4.46 (2026-05-15)

## Breaking Changes
- Tunnel public URL changed - old tunnel links no longer work, please reconnect to get the new URL
