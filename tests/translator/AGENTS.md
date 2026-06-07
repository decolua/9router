# Translation Layer Tests

Tests for `open-sse/translator/`. Goals: (1) data-driven coverage of every provider/model, (2) expose bugs caused by using OpenAI as the intermediate format.

## 1. Translation layer structure (`open-sse/translator/`)

Pipeline uses **OpenAI as the intermediate format**:
- Request: `source → openai → target` (`translateRequest`)
- Response (SSE chunk): `target → openai → source` (`translateResponse`)
- If `source === target` → translation is skipped (passthrough).

Components:
- `index.js` — `translateRequest` / `translateResponse` / `register(from, to, requestFn, responseFn)` / registry.
- `formats.js` — `FORMATS` enum (openai, claude, gemini, gemini-cli, openai-responses, antigravity, kiro, cursor, commandcode, ollama, vertex).
- `request/<from>-to-<to>.js` — one-way request translation.
- `response/<from>-to-<to>.js` — one-way SSE response translation.
- `helpers/` — `openaiHelper.js` (filterToOpenAIFormat), `toolCallHelper.js` (id/arguments), `claudeHelper.js`, `geminiHelper.js`.

**OpenAI-bridge pitfalls** (source of most bugs): going through OpenAI easily loses `thinking`/`reasoning`, image URLs (non-base64), `input_audio`, `is_error`; tool `id`/`index` become unstable (parallel tool calls), non-text system blocks, `tool_choice:"none"`.

## 2. Test layout

| File | Role |
|---|---|
| `matrix.js` | Reads `PROVIDER_MODELS` → builds matrix (alias, model, targetFormat, strip, upstreamId). DRY core. |
| `registerAll.js` | Imports every translator to run `register()` side-effects. **Required** (see §5). |
| `coverage-all-models.test.js` | Tier 1: every model translates without throwing; strip applied correctly. |
| `format-roundtrip.test.js` | Tier 2: tool id/system/parallel survive the bridge. |
| `bugs-openai-bridge.test.js` | Exposes concrete bugs (with source file:line). |

## 3. Running

Always pass `--config tests/vitest.config.js` (the alias config lives there; without it vitest may not resolve `@/...` subpaths).

```bash
# no-cred (default, offline): translator-only files
cd app && npx vitest run --config tests/vitest.config.js "tests/translator/"
cd app && npx vitest run --config tests/vitest.config.js "tests/translator/bugs-openai-bridge.test.js"

# real (calls live providers using credentials from the local DB)
cd app && RUN_REAL=1 npx vitest run --config tests/vitest.config.js "tests/translator/real/"
```
No-cred tests make NO network calls and need NO creds. Real tests (`real/`, gated by `RUN_REAL=1`) read active connections from `~/.9router/db/data.sqlite`, send a tiny prompt per provider through `handleChatCore`, and assert valid SSE. Account/quota errors (401/402/403/429) are treated as credential issues and skipped, not failures.

## 4. Adding a new provider → tests cover it AUTOMATICALLY

Add a provider by adding a key to `open-sse/config/providerModels.js` `PROVIDER_MODELS` (e.g. `newprov: [{ id, targetFormat?, strip?, upstreamModelId? }]`) plus its config in `open-sse/config/providers.js`.

→ `coverage-all-models.test.js` **automatically** runs for the new models with **no test edits**. `matrix.js` reads config directly.

Only add a dedicated test when a provider has a special format that does not round-trip cleanly (see §7).

## 5. `registerAll.js` — why it is required

`translator/index.js` uses `require(...)` (bundler-only) to lazy-load translators. Under vitest/ESM, `require` **silently no-ops** → empty registry → `translateRequest` skips the translation step → **false pass** (data is lost but the test goes green by mistake).

→ Every test calling `translateRequest`/`translateResponse` MUST `import "./registerAll.js"` at the top of the file.

## 6. Bug-exposure convention — `it.fails`

- A bug confirmed in the app but NOT yet fixed → use `it.fails(...)`.
- `it.fails` **passes while the app still has the bug**, **turns red once the bug is fixed** → a reminder to update the test (switch `it.fails` → `it` and confirm correct behavior).
- Pattern for a new bug-exposure test: real input → assert the "should-be-kept" behavior → wrap in `it.fails` + a comment with the source `file:line`.

## 7. Special formats to watch

- `kiro` (binary AWS EventStream), `cursor` (protobuf ConnectRPC), `commandcode` (NDJSON) → responses do NOT round-trip cleanly through openai; test via their executors, not just the translator.
- Single-provider-two-formats (most fragile): `opencode-go` (minimax models → claude, others openai), `github` (escalates `/chat/completions` → `/responses` at runtime), `xiaomi-tokenplan` (claude alias).
- `gemini`/`gemini-cli`: only the LAST system message is kept → earlier system messages are lost.

## 8. Current known bugs (currently `it.fails`)

Grouped per CLI/provider test file. Each row is an `it.fails` case.

**Claude (`bugs-openai-bridge.test.js`, `bugs-claudeCode-context.test.js`)**
| Bug | Source |
|---|---|
| Claude image `source.type="url"` dropped (only base64) | `request/claude-to-openai.js:133-141` |
| `tool_result` image block → raw JSON | `request/claude-to-openai.js:155-173` |
| `tool_result.is_error` lost | `request/claude-to-openai.js:155-173` |
| `thinking`/`redacted_thinking` dropped via bridge | `request/claude-to-openai.js:128` |

**OpenAI → Claude (`bugs-toClaude-context.test.js`)**
| Bug | Source |
|---|---|
| Always injects "You are Claude Code" system prompt | `request/openai-to-claude.js:124-134` |
| `reasoning_content` not mapped to a thinking block | `request/openai-to-claude.js:268-273` |
| `tool_choice:"none"` → `auto` | `request/openai-to-claude.js:298` |
| `input_audio` dropped | `request/openai-to-claude.js` (no audio branch) |

**Codex Responses (`bugs-codexCli-responses.test.js`)**
| Bug | Source |
|---|---|
| Empty-name function_call can leave `tool_calls: []` | `request/openai-responses.js:103` |
| `arguments` not coerced to string | `request/openai-responses.js:109-110` |
| `input_image` uses `file_id` as raw url | `request/openai-responses.js:75-77` |

**Antigravity (`bugs-antigravity.test.js`)**
| Bug | Source |
|---|---|
| functionResponse + functionCall in same content → tool calls dropped | `request/antigravity-to-openai.js:177-189` |
| functionCall without id → random unstable id | `request/antigravity-to-openai.js:167` |

**Kiro (`bugs-kiro.test.js`)**
| Bug | Source |
|---|---|
| `JSON.parse(arguments)` throws on bad JSON (no try/catch) | `request/openai-to-kiro.js:214-216` |
| `max_tokens` hardcoded to 32000 | `request/openai-to-kiro.js:309` |
| Remote image → `[Image: url]` text | `request/openai-to-kiro.js:132-134` |

**Gemini / Cursor / CommandCode (`bugs-gemini-cursor-commandcode.test.js`)**
| Bug | Source |
|---|---|
| Only the last system message kept | `request/openai-to-gemini.js:92-96` |
| Cursor drops image content | `request/openai-to-cursor.js:12-24` |
| Cursor `max_tokens` hardcoded to 32000 | `request/openai-to-cursor.js:179` |
| CommandCode bad JSON args → `{}` silently | `request/openai-to-commandcode.js:53-57` |
| CommandCode image → `[image omitted]` | `request/openai-to-commandcode.js:41-42` |

Fixing a bug → rerun; the matching `it.fails` test turns RED → switch it to a regular `it` and verify correct behavior.
