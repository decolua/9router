---
name: 10router
description: Entry point for 10router — local/remote AI gateway with OpenAI-compatible REST for chat, image, TTS, embeddings, web search, web fetch. Use when the user mentions 10router, TENROUTER_URL, or wants AI without writing provider boilerplate. This skill covers setup + indexes capability skills; fetch the relevant capability SKILL.md from the URLs below when needed.
---

# 10router

Local/remote AI gateway exposing OpenAI-compatible REST. One key, many providers, auto-fallback.

## Setup

```bash
export TENROUTER_URL="http://localhost:20128"      # or VPS / tunnel URL
export TENROUTER_KEY="sk-..."                      # from Dashboard → Keys (only if requireApiKey=true)
```

> The legacy `NINEROUTER_URL` / `NINEROUTER_KEY` names still work as a fallback, but prefer the `TENROUTER_*` names above.

All requests: `${TENROUTER_URL}/v1/...` with header `Authorization: Bearer ${TENROUTER_KEY}` (omit if auth disabled).

Verify: `curl $TENROUTER_URL/api/health` → `{"ok":true}`

## Discover models

```bash
curl $TENROUTER_URL/v1/models                  # chat/LLM (default)
curl $TENROUTER_URL/v1/models/image            # image-gen
curl $TENROUTER_URL/v1/models/tts              # text-to-speech
curl $TENROUTER_URL/v1/models/embedding        # embeddings
curl $TENROUTER_URL/v1/models/web              # web search + fetch (entries have `kind` field)
curl $TENROUTER_URL/v1/models/stt              # speech-to-text
curl $TENROUTER_URL/v1/models/image-to-text    # vision
```

Use `data[].id` as `model` field in requests. Combos appear with `owned_by:"combo"`.

Response shape:
```json
{ "object": "list", "data": [
  { "id": "openai/gpt-5", "object": "model", "owned_by": "openai", "created": 1735000000 },
  { "id": "tavily/search", "object": "model", "kind": "webSearch", "owned_by": "tavily", "created": 1735000000 }
]}
```

## Capability skills

When the user needs a specific capability, fetch that skill's `SKILL.md` from its raw URL:

| Capability | Raw URL |
|---|---|
| Chat / code-gen | https://raw.githubusercontent.com/some-du6e/10router/refs/heads/master/skills/10router-chat/SKILL.md |
| Image generation | https://raw.githubusercontent.com/some-du6e/10router/refs/heads/master/skills/10router-image/SKILL.md |
| Text-to-speech | https://raw.githubusercontent.com/some-du6e/10router/refs/heads/master/skills/10router-tts/SKILL.md |
| Speech-to-text | https://raw.githubusercontent.com/some-du6e/10router/refs/heads/master/skills/10router-stt/SKILL.md |
| Embeddings | https://raw.githubusercontent.com/some-du6e/10router/refs/heads/master/skills/10router-embeddings/SKILL.md |
| Web search | https://raw.githubusercontent.com/some-du6e/10router/refs/heads/master/skills/10router-web-search/SKILL.md |
| Web fetch (URL → markdown) | https://raw.githubusercontent.com/some-du6e/10router/refs/heads/master/skills/10router-web-fetch/SKILL.md |

## Errors

- 401 → set/refresh `TENROUTER_KEY` (Dashboard → Keys)
- 400 `Invalid model format` → check `model` exists in `/v1/models/<kind>`
- 503 `All accounts unavailable` → wait `retry-after` or add another provider account
