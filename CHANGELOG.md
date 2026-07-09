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

