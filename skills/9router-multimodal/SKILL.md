---
name: 9router-multimodal
description: Use images, TTS, STT, web search and web fetch through 9Router's OpenAI-compatible endpoints (image generations, audio speech/transcriptions, search). Covers the MIME-type and account-lock pitfalls proven in dogfood 2026-09-25.
---

# 9Router — Multimodal (image / TTS / STT / search / fetch)

Requires `NINEROUTER_URL` and `NINEROUTER_KEY` (see `skills/9router/SKILL.md` for
setup). Provider below is `gemini`; any provider with the matching `serviceKinds`
works the same way. **If you add a provider connection, restart the server before
your first real call** — the running gateway does not pick up new connections.

## Discover

```bash
curl $NINEROUTER_URL/v1/models/image -H "Authorization: Bearer $NINEROUTER_KEY" | jq -r '.data[].id'
curl $NINEROUTER_URL/v1/models/tts   -H "Authorization: Bearer $NINEROUTER_KEY" | jq -r '.data[].id'
curl $NINEROUTER_URL/v1/models/stt   -H "Authorization: Bearer $NINEROUTER_KEY" | jq -r '.data[].id'
curl $NINEROUTER_URL/v1/models/web   -H "Authorization: Bearer $NINEROUTER_KEY" | jq -r '.data[].id'   # empty unless a search/fetch provider is connected
```

## Image

```bash
curl -X POST "$NINEROUTER_URL/v1/images/generations?response_format=binary" \
  -H "Authorization: Bearer $NINEROUTER_KEY" -H 'Content-Type: application/json' \
  -d '{"model":"gemini/gemini-2.5-flash-image","prompt":"..."}' -o img.png   # 1024x1024 PNG, ~5-7s
```
Without `?response_format=binary` you get OpenAI-shaped JSON with `b64_json`.

## TTS

```bash
curl -X POST "$NINEROUTER_URL/v1/audio/speech" \
  -H "Authorization: Bearer $NINEROUTER_KEY" -H 'Content-Type: application/json' \
  -d '{"model":"gemini/gemini-2.5-flash-preview-tts","input":"...","voice":"Kore"}' -o out.wav
```
Returns raw RIFF WAVE (24kHz mono PCM for Gemini). Warm latency ~1.5s.

## STT — MIND THE MIME TYPE

```bash
# CORRECT — explicit type hint:
curl -X POST "$NINEROUTER_URL/v1/audio/transcriptions" \
  -H "Authorization: Bearer $NINEROUTER_KEY" \
  -F 'file=@out.wav;type=audio/wav' -F model=gemini/gemini-2.5-flash-lite
# -> {"text":"Hello from Nine Router DogFood."}  (~1.5s)

# WRONG — curl sends application/octet-stream and the Gemini path rejects it:
#   400 'Unsupported MIME type: application/octet-stream' — AND it locks the
#   provider account for 30s, so your NEXT call fails with a lock error instead.
```
Always attach `;type=audio/<ext>` (or use a client that sets multipart MIME from
the file extension). Raw streams need a sniffed type — see DF-9ROUTER-43.

## Web search

```bash
curl -X POST "$NINEROUTER_URL/v1/search" \
  -H "Authorization: Bearer $NINEROUTER_KEY" -H 'Content-Type: application/json' \
  -d '{"provider":"gemini","query":"..."}'
```
Field names are `provider` + `query`. `model` accepts only bare provider ids or
`<provider>/search` ids from `/v1/models/web` — a full `provider/model` chat id
fails with `Unknown provider`. Latency ~4–9s (grounding API).

## Web fetch

`/v1/web/fetch` needs a DEDICATED fetch provider (jina-reader, tavily, exa,
firecrawl) with its own credential — chat providers do not fetch. Gemini returns
the honest 400 `Provider gemini does not support web fetch`. Check
`GET /v1/models/web` for `kind:"webFetch"` ids; empty list = no fetch provider
connected.

## Pitfalls

- **Account cooldown mask**: any upstream failure (even a request-scoped 400)
  locks the provider account for 30s; during that window every call fails with
  `all 1 accounts locked ... reset after 30s` instead of the real error. Wait
  it out, then fix the actual cause.
- **Restart after adding a connection** — the gateway reads connections at boot.
- **Port authority**: `.env` `PORT` wins over the environment variable for the
  app's own reads; README/.env.example/package.json scripts have carried
  different values (DF-9ROUTER-44). Verify with a health curl after boot.
- **undici 8 breakage (DF-9ROUTER-42, 2026-09-25)**: on a fresh install of the
  broken commit range, every gemini upstream call fails with
  `Unexpected token '\u001f' ... is not valid JSON` (raw gzip body). If you see
  that error on a fresh install, pin undici to ^7 while the fix lands.
