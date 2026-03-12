# Investigation: kimi JSON Mode Behavior Through 9router

## Summary

We discovered that kimi models behave differently depending on the variant when accessed through 9router's Claude compatibility layer.

## Models Tested

### Non-GH Models Available Through 9router:
- **kimi/kimi-k2.5-thinking** - ADDS markdown code blocks ❌
- **kimi/kimi-k2.5** - Clean JSON ✅
- **kimi/kimi-latest** - Clean JSON ✅
- **free** (OpenCode) - Clean JSON ✅
- **balance** (OpenCode) - Clean JSON ✅
- **sota** (OpenCode) - Clean JSON ✅

## Key Finding

**kimi/kimi-k2.5-thinking is the only model that wraps JSON in markdown code blocks** despite:
- Setting `response_format: {type: "json_object"}`
- Explicit system prompts saying "return ONLY raw JSON"

This appears to be a behavior of the "thinking" variant specifically when accessed through the Claude compatibility layer.

## Root Cause

9router translates OpenAI API requests to Claude-compatible format. The kimi models are accessed via third-party providers (likely OpenRouter or similar) that expose them through a Claude-compatible interface.

The "thinking" variant seems to:
1. Process the request through its reasoning/thinking mechanism
2. Output the thinking process wrapped in markdown
3. Include the JSON response inside markdown code blocks

## Recommendation

**Use kimi/kimi-k2.5 instead of kimi/kimi-k2.5-thinking** for JSON mode operations.

The non-thinking variant provides:
- Clean JSON output without markdown wrapping
- Lower cost (no thinking tokens)
- Faster response times
- Better compatibility with structured output

## Why Keep Markdown Stripping (PR #288)

Even though we found that kimi-k2.5 works without markdown, we should keep the markdown stripping as a **defensive backstop** because:

1. **Model behavior can change** - Future updates to kimi might add markdown
2. **Configuration issues** - Provider misconfigurations could cause markdown output
3. **Other models** - Future models added might have similar issues
4. **Streaming edge cases** - Some streaming scenarios might still produce markdown

The stripping is:
- **Safe** - Idempotent operation (running twice doesn't break anything)
- **Conditional** - Only applies when `response_format` is set
- **Conservative** - Only strips actual markdown code block markers

## Alternative: Native Moonshot API

We attempted to test kimi directly through Moonshot's native API but encountered authentication issues with the provided API key.

**Pros of Native API:**
- Direct access to kimi's native capabilities
- Potentially better JSON mode adherence
- No translation layer overhead

**Cons of Native API:**
- Requires separate provider implementation in 9router
- Different API format (not OpenAI-compatible)
- Additional maintenance burden

**Recommendation:** Stick with 9router's Claude-compatible layer but use `kimi/kimi-k2.5` (non-thinking) for JSON operations.

## Action Items

1. ✅ Document this behavior in 9router PR #288
2. ✅ Update job-tracker-opencode config to use `kimi/kimi-k2.5` instead of `kimi/kimi-k2.5-thinking`
3. ✅ Keep markdown stripping as defensive measure
4. ✅ Test other models periodically as they're added

## Files Changed

- `.env` - Change model from `kimi/kimi-k2.5-thinking` to `kimi/kimi-k2.5`
- PR #288 remains valuable as defensive backstop
