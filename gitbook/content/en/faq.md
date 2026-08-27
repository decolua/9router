# Frequently Asked Questions

---

## What is 9Router?

9Router is an open-source local proxy and token-saver that connects AI coding tools (Claude Code, Cursor, Codex, OpenClaw, Cline, Roo) to 40+ providers with automatic fallback and prompt compression.

---

## Does 9Router charge me any money?

**No.** 9Router is 100% free and open-source software running locally on your computer or server. It has no billing system and cannot charge cards.

Any cost values shown in the analytics dashboard are strictly **reference calculations** to illustrate how much money you save compared to direct API list prices.

---

## How does RTK Token Saver work?

When your coding agent executes a shell command (e.g. `git diff`, `grep`, directory tree), the raw tool result is often filled with repetitive boilerplate. RTK analyzes the first 1KB of the tool output, applies targeted lossy/lossless compression, and reduces input prompt tokens by 20–40% before sending the request to the LLM.

---

## What are Combos?

Combos are custom sequential fallback lists. For example, if you configure `cc/claude-opus-4-7 → glm/glm-5.1 → kr/claude-sonnet-4.5`, 9Router tries your Claude Code subscription first, seamlessly falls back to GLM if your subscription quota is depleted, and falls back to free Kiro AI if needed.

---

## What free options are available?

- **Kiro AI (`kr/`)**: Free quota (~50 credits/month + new account trial) offering Claude 4.5, GLM-5, and MiniMax through AWS Builder ID, Google, or GitHub login.
- **OpenCode Free (`oc/`)**: No-auth model pool auto-fetched from the OpenCode catalog.
- **Google Vertex AI (`vertex/`)**: $300 new account Google Cloud credits.
