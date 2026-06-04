---
name: 9router-image
description: Generate images via 9Router /v1/images/generations using OpenAI / Gemini Imagen / DALL-E / FLUX / MiniMax / SDWebUI / ComfyUI / Codex models. Use when the user wants to create, generate, draw, or render an image, picture, or text-to-image (txt2img).
---

# 9Router — Image Generation

Requires `NINEROUTER_URL` (and `NINEROUTER_KEY` if auth enabled). See https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router/SKILL.md for setup.

## Discover

```bash
curl $NINEROUTER_URL/v1/models/image | jq '.data[].id'
# Per-model params/options (size enum, quality enum, capabilities like edit)
curl "$NINEROUTER_URL/v1/models/info?id=openai/dall-e-3"
```

## Endpoint

`POST $NINEROUTER_URL/v1/images/generations`

| Field | Required | Notes |
|---|---|---|
| `model` | yes | from `/v1/models/image` |
| `prompt` | yes | image description |
| `n` | no | count (provider-dependent) |
| `size` | no | `1024x1024`, `1792x1024`, ... |
| `quality` | no | `standard` / `hd` (OpenAI) |
| `response_format` | no | `url` (default) or `b64_json` |

Add query `?response_format=binary` to receive raw image bytes (handy for saving file).

## Examples

Save to file (binary):

```bash
curl -X POST "$NINEROUTER_URL/v1/images/generations?response_format=binary" \
  -H "Authorization: Bearer $NINEROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini/gemini-3-pro-image-preview","prompt":"watercolor mountains at sunrise","size":"1024x1024"}' \
  --output out.png
```

JS (URL response):

```js
const r = await fetch(`${process.env.NINEROUTER_URL}/v1/images/generations`, {
  method: "POST",
  headers: { "Authorization": `Bearer ${process.env.NINEROUTER_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ model: "gemini/gemini-3-pro-image-preview", prompt: "neon city", size: "1024x1024" }),
});
const { data } = await r.json();
console.log(data[0].url || data[0].b64_json.slice(0, 40));
```

## Response shape

JSON (default `response_format=url`):
```json
{ "created": 1735000000, "data": [{ "url": "https://..." }] }
```

`response_format=b64_json`:
```json
{ "created": 1735000000, "data": [{ "b64_json": "iVBORw0KGgo..." }] }
```

Query `?response_format=binary` returns raw image bytes (Content-Type `image/png` or `image/jpeg`).

## Provider quirks

Common fields above work everywhere. These add/override:

| Provider | Extra/changed fields | Notes |
|---|---|---|
| `openai`, `minimax`, `openrouter`, `recraft` | `quality`, `style`, `response_format` | Standard OpenAI shape |
| `gemini` (nano-banana) | — | Only `prompt`; ignores `size`/`n` |
| `codex` (gpt-5.4-image) | `image`, `images[]`, `image_detail`, `output_format`, `background` | SSE stream; **ChatGPT Plus/Pro required** |
| `huggingface` | — | Only `prompt`; returns single image |
| `nanobanana` | `image`, `images[]` (edit mode) | `size` → aspect ratio; async polling |
| `fal-ai` | `image` (img2img) | `n` → `num_images`; `size` → ratio; async |
| `stability-ai` | `style` (preset), `output_format` | `size` → `aspect_ratio` |
| `black-forest-labs` (FLUX) | `image` (ref) | `size` → exact `width`/`height`; async |
| `runwayml` | `image` (ref) | `size` → ratio; async; video models exist |
| `sdwebui`, `comfyui` | — | Localhost noAuth (`:7860` / `:8188`) |
