# Welcome to 9Router

**Universal AI Router & Token Saver**

9Router connects all your AI coding tools (Claude Code, Cursor, Codex, OpenClaw, Cline, Roo) to 40+ AI providers and 100+ models with smart fallback and token optimization.

---

## ⚡ What 9Router Does

1. **🗜️ RTK Token Compression**: Intercepts command results (`git diff`, `grep`, `ls`, test output) and reduces prompt tokens by 20–40%.
2. **🔄 3-Tier Auto Fallback**: Routes requests from Subscription → Ultra-Cheap → Free tiers so you never hit rate limits.
3. **📊 Live Quota Tracking**: Shows real-time token counts, rolling 5-hour quotas, and reset countdowns.
4. **🔌 Unified API**: Exposes a standard OpenAI-compatible `/v1` endpoint for all upstream providers.

---

## 📐 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Coding Tools (Claude Code, Cursor, Codex, OpenClaw, Cline)   │
└──────────────────────────────┬──────────────────────────────┘
                               │ http://localhost:20128/v1
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                           9Router                           │
│  • RTK Token Compression  • Protocol Translation (OpenAI/Claude)
│  • Quota Tracking         • Multi-Account Load Balancing    │
└──────────────┬──────────────────────┬───────────────────────┘
               │                      │
       [ Tier 1: Subscriptions ]     [ Tier 2: Cheap ]       [ Tier 3: Free / Fallback ]
       • Claude Code (Pro/Max)        • GLM ($0.6/1M)         • Kiro AI (Claude/GLM-5)
       • OpenAI Codex (Plus/Pro)      • MiniMax ($0.2/1M)     • OpenCode Free (no auth)
       • GitHub Copilot / Cursor      • Kimi ($9/mo)          • Vertex AI ($300 credits)
```

---

## 🚀 Quick Setup (3 Steps)

1. **Install and run:**
   ```bash
   npm install -g 9router
   9router
   ```
2. **Connect a provider in the dashboard:**
   Open `http://localhost:20128` and connect **Kiro AI** (free Claude credits) or your existing **Claude / Codex / Copilot** accounts.
3. **Point your tool:**
   Set endpoint `http://localhost:20128/v1` in your CLI or editor.

---

## 📖 Navigation

- **[Quick Start](getting-started/quick-start.md)** — Step-by-step setup in under 2 minutes.
- **[Installation](getting-started/installation.md)** — npm, Docker, and source instructions.
- **[Subscription Providers](providers/subscription.md)** — Maximize Claude Code, Codex, Copilot, Cursor.
- **[Cheap Providers](providers/cheap.md)** — GLM, MiniMax, Kimi setup and pricing.
- **[Free Providers](providers/free.md)** — Kiro AI, OpenCode Free, Vertex AI.
- **[Smart Routing & Combos](features/combos.md)** — Create custom fallback sequences.
- **[Tool Integrations](integration/claude-code.md)** — Guides for Claude Code, Cursor, Codex, Cline, and more.
- **[Troubleshooting](troubleshooting.md)** — Fix common issues fast.
- **[FAQ](faq.md)** — Frequent questions and billing explanation.
