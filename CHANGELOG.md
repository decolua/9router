# v0.4.28 (2026-05-10)

## Features
- Add bun:sqlite adapter with automatic runtime detection (Bun/Node)
- Add bulk API key import (format: `name|sk-key`, one per line)

## Fixes
- Fix add API key for custom providers

# v0.4.27 (2026-05-09)

## Features
- Add 3-tier DB driver fallback: better-sqlite3 → node:sqlite (Node ≥22.5) → sql.js

## Fixes
- Fix authentication logic for several providers

# v0.4.25 (2026-05-09)

## Features
- Add MCP Marketplace Modal to Cowork Tool Card for easier plugin management
- Migrate DB layer from lowdb to SQLite with modular repos pattern (better-sqlite3 / sql.js adapters, migrations, helpers)
- Add Tailscale tunnel integration with status check API
- Add `/api/cli-tools/all-statuses` aggregated endpoint
- Add Cloudflare Workers AI image generation support (#973)
- Add DeepSeek V4 Pro model and update V4 pricing (#938)
- Add captain-definition for Caprover deployment (#954)

## Improvements
- Optimize slow page load performance
- Refactor connection proxy configuration logic (#970)

## Fixes
- Prevent cached settings responses (#951)
- Normalize Ollama Local provider input (#955)

## Docs
- Add Chinese translation of README (#957)
- Fix localized README links (#956)

# v0.4.20 (2026-05-07)

## Features
- Add CommandCode provider support

# v0.4.19 (2026-05-07)

## Features
- Add OllamaLocalExecutor cho local Ollama provider
- Add audio input support cho Gemini translation
- Add configurable tunnel transport protocols
- Add model deselection trong ComboFormModal & ComboDetailPage
- ComboFormModal/BaseUrlSelect: cloud endpoint option, custom URL local state, default first option
- New API: `/v1/audio/voices`, `/v1/models/info`; `/v1/models` filter disabled models
- CLI tool cards refactor dùng BaseUrlSelect

## Fixes
- Fix compatible provider API key setup
- Fix usage: filter `totalRequests` theo time period đã chọn
- Fix Kiro IDE MITM handler bugs (AWS CodeWhisperer translation)
- geminiHelper: `ensureObjectType` cho schemas có properties nhưng thiếu type
- initializeApp: guard tunnel/tailscale auto-resume once-per-process

# v0.4.18 (2026-05-05)

## Features
- Speech-to-Text: full pipeline with sttCore + /v1/audio/transcriptions; configs for OpenAI, Gemini, Groq, Deepgram, AssemblyAI, HuggingFace, NVIDIA Parakeet; new 9router-stt skill
- Gemini TTS: dedicated provider with 30 prebuilt voices
- Usage quotas: GLM (intl/cn) and MiniMax (intl/cn) fetchers; Gemini CLI usage via retrieveUserQuota per-model buckets
- Disabled models: lowdb-backed disabledModelsDb + /api/models/disabled route
- Header search: reusable Zustand store wired into Header
- CLI tools: Claude Cowork tool card + cowork-settings API
- Providers: mediaPriority sorting in getProvidersByKind, add Kimi K2.6

## Improvements
- Expand media-providers/[kind]/[id] page; enhance OAuthModal, ModelSelectModal, ProviderTopology, ProxyPools, ProviderLimits
- Refresh provider icons (alicode, byteplus, cloudflare-ai, nvidia, ollama, vertex, volcengine-ark); add aws-polly, fal-ai, jina-ai, recraft, runwayml, stability-ai, topaz, black-forest-labs
- Reorder hermes provider, drop qwen STT kind

## Fixes
- Fix skills metadata/text in 9router, chat, embeddings, image, tts, web-fetch, web-search SKILL.md and skills page

# v0.4.16 (2026-05-04)

## Features
- Skills system: manage and execute custom AI skills

## Fixes
- Fix input fields in tool cards

# v0.4.14 (2026-05-03)

## Improvements
- Token refresh: in-flight request caching to prevent race conditions & reduce duplicate API calls
- Token refresh: handle unrecoverable errors with token reuse/invalidation
- MITM server: handle port 443 conflicts (kill occupying process before start)
- Better UX feedback in MitmServerCard for port conflicts & admin privileges
- Refactor ComboList for streamlined media provider combos display

# v0.4.13 (2026-05-03)

## Features
- Add Azure OpenAI as dedicated provider (endpoint/deployment/API version/organization config)
- Add browser-local endpoint presets for CLI tools (Claude, Codex, OpenCode, Droid, OpenClaw, Hermes, Copilot)
- Add Codex review model quota support
- Add DNS tool state persistence in MITM manager

## Improvements
- New brand color palette with better light/dark theme consistency
- Improve mobile layouts and restore Cloudflare provider
- Improve zh-CN translations
- Better admin privilege feedback in MitmServerCard
- Refined APIPageClient layout
- Filter LLM combos to show only relevant data

## Fixes
- Include alias-backed models in /v1/models listing
- Improve cloudflared exit code error messages
- Redirect ~/.9router to DATA_DIR in Docker (persist usage across updates)
- Prevent SSE listener leak in console-logs stream
- Gate MITM sudo prompts on server platform
- Fix Azure validation and persistence (providerSpecificData, Organization required)

# v0.4.12 (2026-05-01)

## Features
- Add Xiaomi MiMo provider support
- Add sticky round-robin strategy for combos

## Improvements
- Refactor proxyFetch and enhance MediaProviderDetailPage layout
- Improve dashboard responsive layouts
- Update provider models list

## Fixes
- Fix custom provider prefix conflicts with built-in alias
- Strip output_config for MiniMax requests

# v0.4.11 (2026-04-30)

## Features
- Add Caveman feature: terse-style system prompts to reduce output token usage with configurable compression levels
- Add Caveman settings UI in Endpoint dashboard (enable/disable, compression level)

## Improvements
- Consolidate AntigravityExecutor function declarations for Gemini compatibility
- Clean up translator initialization logs across API routes

# v0.4.10 (2026-04-29)

## Features
- Add new embedding models and Voyage AI provider support
- Add Coqui, Inworld, Tortoise TTS providers
- Add Deepgram and Inworld TTS voices API endpoints

## Improvements
- Enhance MITM Antigravity handler with improved cert install and DNS config
- Refactor TTS handling to support additional providers
- Improve API key validation for media providers
- Enhance MITM logger with better diagnostics
- Add Windows elevated permissions support for MITM

## Fixes
- Fix Antigravity MITM connection and handler issues
- Fix cloudflared tunnel integration with MITM

# v0.4.8 (2026-04-28)

## Features
- Add Web Search & Web Fetch providers with Combo support — chain multiple search/fetch providers as a single virtual provider
- Add Cloudflare AI provider support
- Add provider filter and expiry sorting to quota dashboard (#769)

## Improvements
- Proxy-aware token refresh across executors (Antigravity, Base, Default, Github, Kiro)

## Fixes
- Fix granular `reasoning_effort` handling for Claude models on Copilot & Anthropic backend (#791)
- Fix Antigravity INVALID_ARGUMENT errors and Copilot agent mode parity
- Fix quota reset timestamp parsing (#768)

# v0.4.6 (2026-04-25)

## Features
- Add BytePlus Provider
- Add Codex support to image providers
- Enhance image and embedding provider support

## Improvements
- Cap maximum cooldown for rate limit handling in account unavailability and single-model chat flows
- Dynamic custom model fetching for model selection

# v0.4.5 (2026-04-24)

## Improvements
- Cap maximum cooldown for rate limit handling in account unavailability and single-model chat flows
- Dynamic custom model fetching for model selection

# v0.4.3 (2026-04-24)

## Improvements
- Improve in-app download/update UX on dashboard
- Improve Codex provider rate limit handling with precise cooldown (`resetsAtMs`) and email backfill for OAuth accounts

# v0.4.2 (2026-04-24)

## Features
- Add Azure OpenAI provider support
- Add built-in Volcengine Ark provider support (#741)
- Add GPT 5.5 model

## Fixes
- Enhance retry logic and configuration for HTTP status codes

# v0.4.1 (2026-04-23)

## Features
- Add Hermes CLI tool with settings management and integration
- Add in-app version update mechanism (appUpdater + /api/version/update)

## Improvements
- Strengthen CLI token validation for enhanced security
- Enhance Sidebar layout for CLI tools
- Update executors and runtime config

# v0.3.98 (2026-04-22)

## Features
- Add RTK — filter context (ls/grep/find/.....) before sending to LLM to save tokens

# v0.3.97 (2026-04-22)

## Features
- Add OpenCode Go provider and support for custom models
- Add Text To Image provider
- Support custom host URL for remote Ollama servers

## Fixes
- Fix copy to clipboard issue

# v0.3.96 (2026-04-17)

## Features
- Add marked package for Markdown rendering
- Enhance changelog styles

## Improvements
- Refactor error handling to config-driven approach with centralized error rules
- Refactor localDb structure
- Update Qwen executor for OAuth handling
- Enhance error formatting to include low-level cause details
- Refactor HeaderMenu to use MenuItem component
- Improve LanguageSwitcher to support controlled open state
- Update backoff configuration and improve CLI detection messages
- Add installation guides for manual configuration in tool cards (Droid, Claude, OpenClaw)

## Fixes
- Fix Codex image URL fetches to await before sending upstream (#575)
- Strip thinking/reasoning_effort for GitHub Copilot chat completions (#623)
- Enable Codex Apply/Reset buttons when CLI is installed (#591)
- Show manual config option when Claude CLI detection fails (#589)
- Show manual config option when OpenClaw detection fails (#579)
- Ensure LocalMutex acquire returns release callback correctly (#569)
- Strip enumDescriptions from tool schema in antigravity-to-openai (#566)
- Strip temperature parameter for gpt-5.4 model (#536)
- Add Blackbox AI as a supported provider (#599)
- Add multi-model support for Factory Droid CLI tool (#521)
- Add GLM-5 and MiniMax-M2.5 models to Kiro provider (#580)
- Fix usage tracking bug

# v0.3.91 (2026-04-15)

## Features
- Add Kiro AWS Identity Center device flow for provider OAuth
- Add TTS (Text-to-Speech) core handler and TTS models config
- Add media providers dashboard page
- Add suggested models API endpoint

## Improvements
- Refactor error handling to config-driven approach with centralized error rules
- Refactor localDb and usageDb for cleaner structure

## Fixes
- Fix usage tracking bug

# v0.3.90 (2026-04-14)

## Features
- Add proactive token refresh lead times for providers and Codex proxy management
- Enhance CodexExecutor with compact URL support

## Improvements
- Enhance Windows Tailscale installation with curl support and fallback to well-known Windows path
- Refactor execSync and spawn calls with windowsHide option for better Windows compatibility

## Fixes
- Fix noAuth support for providers and adjusted MITM restart settings
- Bug fixes

# v0.3.89 (2026-04-13)

## Improvements
- Improved dashboard access control by blocking tunnel/Tailscale access when disabled

# v0.3.87 (2026-04-13)

## Fixes
- Fix codex cache session id

# v0.3.86 (2026-04-13)

## Features
- Add provider models and thinking configurations for enhanced chat handling
- Add Vercel relay support to proxy functionality
- Add Vercel deploy endpoint for proxy pools management

## Improvements
- Enhance proxy functionality with new relay capabilities
- Streamline GitHub Actions Docker publish workflow
- Update Docker configuration and package management

## Fixes
- Remove obsolete 9remote installation/management APIs

# v0.3.83 (2026-04-08)

## Fixes
- Fix OpenRouter custom models not showing after being added

# Unreleased

## Features
- Added API key visibility toggle (eye icon) to Endpoint dashboard page for improved UX and security.

# v0.2.66 (2026-02-06)

## Features
- Added Cursor provider end-to-end support, including OAuth import flow and translator/executor integration (`137f315`, `0a026c7`).
- Enhanced auth/settings flow with `requireLogin` control and `hasPassword` state handling in dashboard/login APIs (`249fc28`).
- Improved usage/quota UX with richer provider limit cards, new quota table, and clearer reset/countdown display (`32aefe5`).
- Added model support for custom providers in UI/combos/model selection (`a7a52be`).
- Expanded model/provider catalog:
  - Codex updates: GPT-5.3 support, translation fixes, thinking levels (`127475d`)
  - Added Claude Opus 4.6 model (`e8aa3e2`)
  - Added MiniMax Coding (CN) provider (`7c609d7`)
  - Added iFlow Kimi K2.5 model (`9e357a7`)
  - Updated CLI tools with Droid/OpenClaw cards and base URL visibility improvements (`a2122e3`)
- Added auto-validation for provider API keys when saving settings (`b275dfd`).
- Added Docker/runtime deployment docs and architecture documentation updates (`5e4a15b`).

## Fixes
- Improved local-network compatibility by allowing auth cookie flow over HTTP deployments (`0a394d0`).
- Improved Antigravity quota/stream handling and Droid CLI compatibility behavior (`3c65e0c`, `c612741`, `8c6e3b8`).
- Fixed GitHub Copilot model mapping/selection issues (`95fd950`).
- Hardened local DB behavior with corrupt JSON recovery and schema-shape migration safeguards (`e6ef852`).
- Fixed logout/login edge cases:
  - Prevent unintended auto-login after logout (`49df3dc`)
  - Avoid infinite loading on failed `/api/settings` responses (`01c9410`)

# v0.2.56 (2026-02-04)

## Features
- Added Anthropic-compatible provider support across providers API/UI flow (`da5bdef`).
- Added provider icons to dashboard provider pages/lists (`60bd686`, `8ceb8f2`).
- Enhanced usage tracking pipeline across response handlers/streams with buffered accounting improvements (`a33924b`, `df0e1d6`, `7881db8`).

## Fixes
- Fixed usage conversion and related provider limits presentation issues (`e6e44ac`).

# v0.2.52 (2026-02-02)

## Features
- Implemented Codex Cursor compatibility and Next.js 16 proxy migration updates (`e9b0a73`, `7b864a9`, `1c6dd6d`).
- Added OpenAI-compatible provider nodes with CRUD/validation/test coverage in API and UI (`0a28f9f`).
- Added token expiration and key-validity checks in provider test flow (`686585d`).
- Added Kiro token refresh support in shared token refresh service (`f2ca6f0`).
- Added non-streaming response translation support for multiple formats (`63f2da8`).
- Updated Kiro OAuth wiring and auth-related UI assets/components (`31cc79a`).

## Fixes
- Fixed cloud translation/request compatibility path (`c7219d0`).
- Fixed Kiro auth modal/flow issues (`85b7bb9`).
- Included Antigravity stability fixes in translator/executor flow (`2393771`, `8c37b39`).

# v0.2.43 (2026-01-27)

## Fixes
- Fixed CLI tools model selection behavior (`a015266`).
- Fixed Kiro translator request handling (`d3dd868`).

# v0.2.36 (2026-01-19)

## Features
- Added the Usage dashboard page and related usage stats components (`3804357`).
- Integrated outbound proxy support in Open SSE fetch pipeline (`0943387`).
- Improved OpenAI compatibility and build stability across endpoint/profile/providers flows (`d9b8e48`).

## Fixes
- Fixed combo fallback behavior (`e6ca119`).
- Resolved SonarQube findings, Next.js image warnings, and build/lint cleanups (`7058b06`, `0848dd5`).

# v0.2.31 (2026-01-18)

## Fixes
- Fixed Kiro token refresh and executor behavior (`6b22b1f`, `1d481c2`).
- Fixed Kiro request translation handling (`eff52f7`, `da15660`).

# v0.2.27 (2026-01-15)

## Features
- Added Kiro provider support with OAuth flow (`26b61e5`).

## Fixes
- Fixed Codex provider behavior (`26b61e5`).

# v0.2.21 (2026-01-12)

## Changes
- README updates.
- Antigravity bug fixes.
