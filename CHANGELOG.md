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

## Fixes
- fix(volcengine-ark): clamp GLM-5 max_tokens to model output ceiling (#2428)
- fix(kimi): normalize reasoning_effort to backend enum (#2427)
- fix(translator): preserve developer instructions in openai-responses conversion (#2434)
- fix(mitm): recover from stale lock file on server start
- fix(headroom): proxy dashboard through app (#2372)

## Chore
- docs: add CLAUDE.md guidance for Claude Code (#2354)
- feat(i18n): add Farsi (fa) language support (#2385)
- fix(claude): reconcile max_tokens vs thinking budget and lift per-model ceiling (#2381)
- fix(kiro): deliver system prompt natively, add Opus 4.5/4.7/4.8, tolerate dash version ids (#2366)
- fix(count_tokens): count structured Anthropic blocks (#2419)
- feat(rtk): add JS-native git-log filter (#2423)
- feat(caveman): add targeted upstream-aligned style rules (#2424)

# Unreleased

## Fixes
- Fix runtime installs in `~/.9router/runtime` pruning sibling packages. The SQLite (`better-sqlite3`) and tray (`systray2`) lazy installs now save to `package.json` instead of passing `--no-save`, so the second install no longer prunes the first.

