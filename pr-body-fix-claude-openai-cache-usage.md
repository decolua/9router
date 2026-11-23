## fix(stream): forward Claude cache usage to OpenAI-format clients

### Problem
When an OpenAI-format client (Kilo Code, opencode, any `@ai-sdk/openai-compatible` user) talks to a Claude upstream, the final usage chunk never contains cache counts, even though Anthropic reports them and the cache is hit.

Logged example (claude-sonnet, second identical request):

| | Anthropic `message_delta` usage | 9Router -> client |
|---|---|---|
| input | 44 | |
| cache_read_input_tokens | 15271 | |
| prompt_tokens | | 17315 (44 + 15271 + 2000 buffer) |
| prompt_tokens_details.cached_tokens | | **missing** |

### Cause
- `claude-to-openai.js` builds the final chunk's usage correctly with `toOpenAIUsage(..., "claude")`, including `prompt_tokens_details.cached_tokens`.
- `utils/stream.js` (translate mode, finish chunk) then replaces `item.usage` with `filterUsageForFormat(addBufferToUsage(state.usage))`.
- `state.usage` stores Claude field names (`cache_read_input_tokens`, `cache_creation_input_tokens`), which the OpenAI field filter drops.

Separately, the `message_stop` fallback in `claude-to-openai.js` (used when `message_delta` carried no `stop_reason`) builds usage from `input_tokens` only. It drops the cache counts, and its `prompt_tokens` excludes cached input (44 instead of 15315 in the example above).

### Fix
- `stream.js`: for the Claude -> OpenAI direction only, buffer and forward the translator's OpenAI usage instead of `state.usage`. `state.usage` is left unchanged for logging and stats. Other formats keep the current code path.
- `claude-to-openai.js`: the `message_stop` fallback uses `toOpenAIUsage(..., "claude")`, the same math as `message_delta`.

### Verified on a real installation
9Router 0.5.119 on Windows: the release build and the same tag built from source with this patch, same data directory and accounts. Each combo got the same ~6K-token request twice, as an OpenAI-format client sends it (no `cache_control`). Second request:

| Upstream model | Before (released build) | After (with patch) |
|---|---|---|
| claude-sonnet-5-5 | prompt_tokens 13340, no cache fields | prompt_tokens 13341, `cached_tokens` 11328 |
| claude-haiku-5-5 | prompt_tokens 13338, no cache fields | prompt_tokens 13339, `cached_tokens` 11326 |
| gpt-6.2-sol (codex, unaffected) | prompt_tokens 8334 | prompt_tokens 8334 |

The cache was already being hit before the patch; only the reporting to the client changes.

### Tests
New file `tests/unit/claude-openai-cache-usage.test.js`:
- cache read -> `prompt_tokens_details.cached_tokens`
- cache write -> `prompt_tokens_details.cache_creation_tokens`
- no cache -> unchanged shape
- `message_stop` fallback includes cache in `prompt_tokens`

On the current code, 3 of the 4 tests fail; with the fix, all 4 pass. The real logged Sonnet and Haiku responses, replayed through the stream, now report `cached_tokens` 15271 and 15269.

Verification note: the full vitest suite was not run, because dependencies could not be installed in my environment. The 23 existing unit tests that import `stream.js`, `usageTracking.js`, `claude-to-openai.js` or `concerns/usage.js` were run with a minimal test runner. They gave identical results before and after the change. Please run the full suite in CI.
