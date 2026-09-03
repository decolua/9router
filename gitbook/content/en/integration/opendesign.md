# OpenDesign Integration

Integrate 9Router with [OpenDesign](https://github.com/Diwak4r/OpenDesign), an AI-native design agent IDE, to route every visual and code generation request through 9Router's intelligent routing system.

## Why OpenDesign + 9Router

OpenDesign treats prompts like design specs — image-aware inputs, layout intent, palette constraints, and structured outputs. Pairing it with 9Router gives you:

- **Quota-safe iteration** — keep designing on subscription/fallback tiers without burning paid seats
- **Multi-model fan-out** — compare a vision-capable model and a code-capable model on the same brief
- **Auto-fallback** — if a provider rate-limits mid-iteration, 9Router silently rotates to the next configured one
- **Unified usage telemetry** — see every render, generate, and edit request in one dashboard

## Prerequisites

- OpenDesign installed (CLI or desktop build)
- 9Router running locally **or** a 9Router cloud endpoint configured
- An API key from the 9Router dashboard

> **Note**: OpenDesign supports both `localhost` and cloud endpoints. Pick whichever fits your setup.

## Setup

### 1. Open OpenDesign Settings

1. Launch OpenDesign
2. Open **Settings → Providers**
3. Click **Add Custom Provider**

### 2. Configure Base URL

Set the base URL to your 9Router endpoint:

**For Local 9Router:**
```
http://localhost:20128/v1
```

**For Cloud 9Router:**
```
https://9router.com/v1
```

**Steps:**
1. In the **Base URL** field, paste your 9Router endpoint
2. Make sure the path ends with `/v1`

### 3. Add API Key

1. In the **API Key** field, enter your 9Router API key
2. Find it in 9Router dashboard under **Settings → API Keys**
3. Keys start with `sk-9router-`

### 4. Pick Default Model

OpenDesign lets you set a default model for chat and a separate default for generation. Recommended pairings:

| Task | Model prefix | Example |
|---|---|---|
| Visual reasoning (default) | `cc/` | `cc/claude-sonnet-4-20250514` |
| Fast iteration | `glm/` | `glm/glm-4-flash` |
| Code-heavy layout work | `cx/` | `cx/deepseek-chat` |

OpenDesign auto-detects all models available on your 9Router instance via the `/v1/models` endpoint.

### 5. Enable Image-Aware Mode

In **Settings → Generation**, toggle **Image-aware prompts**. This wraps attached images as proper `image_url` parts in the OpenAI payload — 9Router passes them through to the underlying provider.

### 6. Save and Verify

Click **Test Connection**. OpenDesign will send a `GET /v1/models` request to 9Router. A green checkmark means routing is live.

## Configuration Example

Your OpenDesign provider entry should look like:

```
Name:        9Router
Base URL:    http://localhost:20128/v1
API Key:     sk-9router-xxxxxxxxxxxxx
Chat Model:  cc/claude-sonnet-4-20250514
Gen Model:   glm/glm-4-plus
Streaming:   on
Image-aware: on
```

## Available Models

You can use any model exposed by your 9Router dashboard. The ones that work best for design workflows:

| Model Name | Provider | Best for |
|---|---|---|
| `cc/claude-sonnet-4-20250514` | Anthropic | Visual reasoning, layout critique |
| `cc/claude-opus-4-5-20251101` | Anthropic | High-fidelity spec drafting |
| `cx/deepseek-chat` | DeepSeek | Code generation, component scaffolds |
| `glm/glm-4-plus` | Zhipu AI | Fast iteration, color/palette work |
| `gemini/gemini-2.0-flash` | Google | Multi-modal attachments, quick previews |

Switch models per-project under **Project → Model**.

## Usage

### Chat with Design Context

1. Open a design file (`.opendsg`, Figma JSON, image, or sketch)
2. Open the chat panel (`Cmd/Ctrl + Shift + L`)
3. Reference specific layers: *"Tighten the hero padding to 32px and bump the CTA contrast to AA"*
4. OpenDesign attaches the current canvas as `image_url` context; 9Router forwards it to the chat model

### Generate Components

1. Press `Cmd/Ctrl + G` to open the generate dialog
2. Describe the component: *"A pricing card with three tiers, sticky CTA, dark mode"*
3. OpenDesign requests a code-capable model via 9Router and renders the result inline

### Iterate on a Mock

1. Drop a screenshot or wireframe into the canvas
2. Ask: *"Generate a high-fidelity Tailwind version of this, keep the spacing"*
3. OpenDesign streams tokens back through 9Router; you can interrupt and steer at any time

### Palette and Token Work

1. Select a color on the canvas
2. Ask: *"Build a 12-step token scale around this base, perceptually uniform"*
3. The generated tokens land as named variables you can reuse across the project

## Troubleshooting

### "Connection Failed"

1. Verify 9Router is running: `curl http://localhost:20128/health`
2. Confirm base URL ends with `/v1`
3. Check no firewall is blocking port 20128
4. In OpenDesign, click **Test Connection** again

### "Invalid API Key"

1. Re-copy the key from the 9Router dashboard
2. Confirm the `sk-9router-` prefix is intact
3. Check the key has not been revoked under **Settings → API Keys**

### "Model Not Found"

1. Run `curl http://localhost:20128/v1/models` and verify the exact model id
2. Confirm the underlying provider is connected in 9Router dashboard (green status)
3. Try the qualified name: `cc/claude-sonnet-4-20250514` instead of `claude-sonnet-4`

### Image Attachments Not Honored

1. Confirm **Image-aware prompts** is enabled in OpenDesign settings
2. Verify the active model supports vision (check provider docs)
3. Check 9Router logs — image parts should appear under `messages[].content[].type == "image_url"`

### Slow First Token

1. OpenDesign waits for the first byte before rendering — large prompts slow this
2. Use **Streaming** + a faster model for chat, reserve the heavy model for generation
3. Pre-warm combos in 9Router dashboard so the fallback path is already connected

## Best Practices

1. **Match model to task** — use a vision-capable model for visual critique, a code model for scaffolds, a fast model for palette work
2. **Compose via combos** — in 9Router, build a combo that fans the same brief to two models and picks the cheaper valid response
3. **Watch quota** — design iteration is token-heavy; pin the dashboard open while you work
4. **Reuse via projects** — store model + base URL at the project level so different projects can pin different tiers
5. **Rotate API keys** — generate a fresh `sk-9router-` key every 60 days

## Integration with 9Router Features

### Smart Routing

9Router picks the cheapest provider that still meets the model's availability and health constraints — perfect for tight iteration loops.

### Combos

Chain two or three providers so a Claude vision pass can fall back to GLM, then to Gemini Flash, all without OpenDesign noticing.

### Quota Tracking

Every render, generate, and edit call lands in the dashboard under **Usage**. Filter by `provider=opendesign` to isolate design work.

### Token Savers

Pair OpenDesign with [RTK](https://github.com/rtk-ai/rtk) or [Headroom](https://github.com/chopratejas/headroom) upstream of 9Router to compress long canvas descriptions before they hit the model.

## Next Steps

- [Browse other integrations](other-tools.md)
- [Set up smart routing](../features/smart-routing.md)
- [Configure combos and fallback](../features/combos.md)
- [Track quota across providers](../features/quota-tracking.md)