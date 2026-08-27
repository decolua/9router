# Cheap Providers (Backup Tier)

When your primary subscription quota is depleted, fallback to ultra-low-cost API models. Pay pennies instead of standard expensive API rates.

---

## Supported Cheap Providers

| Provider | Prefix | Top Models | Price (per 1M input tokens) | Reset Cycle |
|---|---|---|---|---|
| **GLM (Zhipu AI)** | `glm/` | `glm/glm-5.1`, `glm/glm-4.7` | ~$0.60 | Daily 10:00 AM (UTC+8) |
| **MiniMax** | `minimax/` | `minimax/MiniMax-M2.7`, `minimax/MiniMax-M2.5` | ~$0.20 | 5-hour rolling window |
| **Kimi (Moonshot)** | `kimi/` | `kimi/kimi-k2.5`, `kimi/kimi-k2.5-thinking` | ~$9 / 10M tokens flat | Monthly |

---

## Setup Steps

1. Get your API key from the provider portal:
   - [Zhipu AI](https://open.bigmodel.cn/)
   - [MiniMax](https://www.minimax.io/)
   - [Moonshot AI](https://platform.moonshot.ai/)
2. Open 9Router Dashboard at `http://localhost:20128` → **Providers** → **Add API Key**.
3. Select the provider and paste your key.
4. Call models using the prefix, e.g. `glm/glm-5.1` or `minimax/MiniMax-M2.7`.

---

## When to Use

- As step 2 in your fallback combos when Claude/Codex quotas run out.
- For massive token workloads (large codebases, batch tests, full file scans) where paying $20/1M on standard APIs is too costly.
