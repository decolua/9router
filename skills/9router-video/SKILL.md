---
name: 9router-video
description: Generate videos via 9Router /v1/videos/generations using xAI Grok Imagine (grok-imagine-video). Async job flow - submit, poll request_id until done, download MP4. Use when the user wants to create, generate, or render a video, text-to-video (txt2vid), or image-to-video.
---

# 9Router — Video Generation (xAI Grok Imagine)

Requires `NINEROUTER_URL` (and `NINEROUTER_KEY` if auth enabled). See https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router/SKILL.md for setup.

Requires a connected **xAI account** in the 9Router dashboard — either **Grok Build OAuth** (SuperGrok / X Premium+ subscription sign-in) or a direct **xAI API key** from console.x.ai. The two are separate auth types with separate billing; the dashboard shows which one each connection uses.

## Endpoints (async job flow)

Video generation is **asynchronous**: the POST returns a `request_id` immediately, then you poll until the job is `done` or `failed`.

| Endpoint | Purpose |
|---|---|
| `POST /v1/videos/generations` | text-to-video / image-to-video |
| `POST /v1/videos/edits` | edit an existing video |
| `POST /v1/videos/extensions` | extend an existing video |
| `GET /v1/videos/{request_id}` | poll job status |

Request fields (passed through to xAI unchanged — see https://docs.x.ai/developers/rest-api-reference/inference/videos):

| Field | Required | Notes |
|---|---|---|
| `model` | no | `xai/grok-imagine-video` (prefix is stripped before upstream) |
| `prompt` | yes for T2V | video description |
| `duration` | no | seconds |
| `aspect_ratio` | no | `16:9`, `9:16`, `1:1`, `4:3`, `3:4`, `3:2`, `2:3` |
| `resolution` | no | `480p`, `720p`, `1080p` |
| `image` | no | `{ "url": "https://… or data:image/…;base64,…" }` for image-to-video |
| `video` | edits/extensions | `{ "url": "…mp4" }` or `{ "file_id": "…" }` |

## Examples

Submit a job:

```bash
curl -X POST "$NINEROUTER_URL/v1/videos/generations" \
  -H "Authorization: Bearer $NINEROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"xai/grok-imagine-video","prompt":"A cinematic tracking shot through a neon city at night","duration":8,"aspect_ratio":"16:9","resolution":"720p"}'
# → {"request_id":"abc123"}   (response header x-9router-connection-id: <id>)
```

Poll until done (echo the connection header back so the same account polls the job):

```bash
curl "$NINEROUTER_URL/v1/videos/abc123" \
  -H "Authorization: Bearer $NINEROUTER_KEY" \
  -H "x-connection-id: <id from create response>"
# → {"status":"pending","progress":42}
# → {"status":"done","video":{"url":"https://…mp4","duration":8},"model":"grok-imagine-video"}
# → {"status":"failed","error":{"code":"…","message":"…"}}
```

Download: fetch `video.url` from the `done` response.

## CLI one-shot

```bash
9router xai video \
  --prompt "A cinematic tracking shot through a neon city at night" \
  --output video.mp4
# options: --model --duration --aspect-ratio --resolution --image --timeout --port --api-key
```

Submits, polls with progress, downloads to `video.mp4.part`, atomically renames on success. Ctrl+C cancels cleanly; non-zero exit on failure.

## Notes & limits

- Jobs are **account-bound** upstream: poll with the same connection that created the job (`x-connection-id` header, value from the create response's `x-9router-connection-id`).
- Creation POSTs are **never auto-retried** (a retry could create and bill two videos). Only a 401→token-refresh→single-retry is performed, which upstream rejects before job creation.
- Video models are tagged `kind: "video"` and are excluded from chat model lists and chat fallback combos.
- Grok Build **subscription OAuth** tokens are sent to the same `api.x.ai/v1/videos` endpoints as API keys; whether a given subscription tier includes video-generation quota is controlled by xAI and is not verified by 9Router — a `403`/`permission_denied` from upstream means the connected account has no video access.
