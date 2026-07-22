---
name: 9router-image
description: Generate and edit images through 9Router's OpenAI-compatible /v1/images/generations endpoint, including text-to-image, image-to-image, one or multiple reference images, Codex GPT Image, and Antigravity Gemini image models. Use when the user asks to create, draw, render, edit, combine, restyle, or test images through 9Router, or needs help diagnosing invalid image payloads, blank outputs, quota limits, or account failover.
---

# 9Router Image Generation

Require `NINEROUTER_URL` and, when API-key protection is enabled, `NINEROUTER_KEY`. Read the setup skill at https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router/SKILL.md when either value is missing.

## Discover models

```bash
curl "$NINEROUTER_URL/v1/models/image" | jq '.data[].id'
curl "$NINEROUTER_URL/v1/models/info?id=cx/gpt-image-2"
```

Inspect model capabilities before attaching references. Prefer models advertising `edit` and `multiImage` for image-to-image work.

Important image-edit models include:

- `cx/gpt-image-2` and `cx/gpt-image-1.5`: Codex/ChatGPT image tools; require an entitled Plus/Pro account.
- `cx/gpt-5.5-image`, `cx/gpt-5.4-image`, and `cx/gpt-5.3-image`: Codex image-generation routes.
- `ag/gemini-3.1-flash-image`: Antigravity text-to-image and multi-reference editing.

## Endpoint

Send requests to:

```text
POST $NINEROUTER_URL/v1/images/generations
```

Use these common fields:

| Field | Required | Purpose |
|---|---|---|
| `model` | yes | Provider/model ID from `/v1/models/image` |
| `prompt` | yes | Describe the final image or edit |
| `image` | no | One reference: HTTP(S) URL, image data URL, or raw image base64 |
| `images` | no | Multiple references using an array of valid image values |
| `size` | no | Model-specific size such as `1024x1024` or `auto` |
| `quality` | no | Model-specific quality such as `high`, `standard`, or `auto` |
| `background` | no | Usually `opaque`, `transparent`, or `auto` |
| `image_detail` | no | Reference detail, commonly `high` |
| `output_format` | no | Commonly `png`, `jpeg`, or `webp` |
| `n` | no | Requested count; many providers still return one image |

Add `?response_format=binary` to receive raw image bytes. Otherwise accept either `data[].url` or `data[].b64_json` in the JSON response.

## Keep prompt and references separate

Put instructions only in `prompt`. Put only images in `image` or `images[]`.

Correct:

```json
{
  "model": "cx/gpt-image-2",
  "prompt": "Create one contact sheet using all three references",
  "images": [
    "data:image/jpeg;base64,...",
    "data:image/png;base64,...",
    "https://example.com/reference.webp"
  ]
}
```

Incorrect:

```json
{
  "prompt": "A cat",
  "images": ["Count how many images I attached", "data:image/png;base64,..."]
}
```

9Router validates base64 syntax and image signatures before calling Codex. Invalid client payloads return HTTP 400 without consuming provider quota, rotating accounts, or creating a cooldown.

## Attach local files

Use JavaScript to avoid manually copying large base64 strings:

```js
import fs from "node:fs";

const dataUrl = (path, mime) =>
  `data:${mime};base64,${fs.readFileSync(path).toString("base64")}`;

const response = await fetch(`${process.env.NINEROUTER_URL}/v1/images/generations`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...(process.env.NINEROUTER_KEY
      ? { Authorization: `Bearer ${process.env.NINEROUTER_KEY}` }
      : {}),
  },
  body: JSON.stringify({
    model: "ag/gemini-3.1-flash-image",
    prompt: "Combine both references into one clearly visible poster",
    images: [
      dataUrl("reference-1.jpg", "image/jpeg"),
      dataUrl("reference-2.png", "image/png"),
    ],
    output_format: "png",
  }),
});

const result = await response.json();
if (!response.ok) throw new Error(result.error?.message || `HTTP ${response.status}`);
fs.writeFileSync("out.png", Buffer.from(result.data[0].b64_json, "base64"));
```

Do not print full base64 payloads or responses. Log image count, byte length, MIME type, dimensions, or a shortened placeholder instead.

## Prompt image edits explicitly

Describe one visible final composition. For multiple references, state that every reference must be used.

Use a prompt such as:

```text
Create one high-contrast contact sheet using all 3 attached reference images.
Preserve each reference in a separate bordered panel.
Add the title "3 reference images".
Use an opaque background and do not produce a blank or low-contrast image.
```

Do not use image generation merely to ask how many images the model can see. Use a multimodal chat endpoint for counting, OCR, or image analysis. Image generation creates a new image and may interpret analysis-style prompts as an ambiguous visual edit.

## Handle Codex streaming

Codex image routes support SSE when the request sends:

```http
Accept: text/event-stream
```

Handle `progress`, `partial_image`, `done`, and `error` events. Omit the SSE `Accept` header when a normal JSON response is easier. The successful `done` result contains the OpenAI-compatible image response.

## Handle failures

- HTTP 400 mentioning `images[index]`: fix or remove that array entry. Never retry the same invalid payload against another account.
- HTTP 429 with a reset timestamp: let 9Router lock only that account/model until the exact reset time and automatically try another eligible account.
- All accounts limited: respect the earliest reported reset time instead of repeatedly retrying.
- Antigravity `VALIDATION_REQUIRED` / HTTP 403: verify or reconnect that Google account; other accounts may still serve the request.
- Near-white output with valid references: verify the output is not transparent, then rewrite the prompt as an explicit composition and use `background: "opaque"`, a concrete size, and higher quality.

The successful response includes `x-connection-id`, which identifies the account that actually served the image after fallback.

## Save binary output

```bash
curl -X POST "$NINEROUTER_URL/v1/images/generations?response_format=binary" \
  -H "Authorization: Bearer $NINEROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"ag/gemini-3.1-flash-image","prompt":"watercolor mountains at sunrise"}' \
  --output out.png
```
