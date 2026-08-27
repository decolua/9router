# Free Providers (Zero-Cost Fallback)

Emergency backups and zero-cost options to keep coding even without paid subscriptions or API credits.

---

## Active Free Providers

| Provider | Prefix | Models | Description |
|---|---|---|---|
| **Kiro AI** | `kr/` | `kr/claude-sonnet-4.5`, `kr/glm-5`, `kr/MiniMax-M2.5`, `kr/deepseek-3.2` | Free quota (~50 credits/month + new account trial) via AWS Builder ID, Google, or GitHub OAuth. |
| **OpenCode Free** | `oc/` | Auto-fetched model catalog | Free no-auth passthrough proxy. |
| **Google Vertex AI** | `vertex/` | `vertex/gemini-3.1-pro-preview`, `vertex/gemini-2.5-flash` | $300 free credits for new Google Cloud accounts (use Vertex AI Studio endpoint). |

---

## Setup Steps

### Kiro AI
1. Dashboard → **Providers** → **Connect Kiro**.
2. Sign in with **AWS Builder ID**, Google, or GitHub.
3. Call with `kr/claude-sonnet-4.5` or `kr/glm-5`.

### OpenCode Free
1. Dashboard → **Providers** → **Connect OpenCode Free**.
2. Ready immediately (no credentials required).

### Vertex AI
1. Dashboard → **Providers** → **Connect Vertex AI**.
2. Upload your Google Cloud Service Account JSON key.

---

## Discontinued Historical Free Tiers

For reference, the following older free tiers were discontinued by their upstream providers:
- ❌ **iFlow**: Changed to paid plans.
- ❌ **Qwen Code (free OAuth)**: Discontinued by Alibaba on 2026-04-15.
- ❌ **Gemini CLI (free OAuth)**: Discontinued by Google on 2026-06-18 (succeeded by Antigravity).
