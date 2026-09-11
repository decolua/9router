# 9Router Nulla Version

A local-first fork of [`decolua/9router`](https://github.com/decolua/9router) focused on practical self-hosted AI routing, API-key model policy, and combo account control.

This repository keeps the core 9Router dashboard and OpenAI-compatible gateway from upstream, while carrying fork-specific changes for stricter access control and easier fork maintenance.

[🇧🇷 Português (Brasil)](./i18n/README.pt-BR.md) • [🇻🇳 Tiếng Việt](./i18n/README.vi.md) • [🇨🇳 中文](./i18n/README.zh-CN.md) • [🇯🇵 日本語](./i18n/README.ja-JP.md) • [🇷🇺 Русский](./i18n/README.ru.md) • [🇹🇭 ไทย](./i18n/README.th.md) • [🇮🇷 فارسی](./i18n/README.fa_IR.md) • [🇮🇩 Indonesia](./i18n/README.id-ID.md) • [🇪🇸 Español](./i18n/README.es.md) • [🇫🇷 Français](./i18n/README.fr.md)

## What This Fork Is

9Router is an OpenAI-compatible routing gateway for AI coding tools and model providers. It sits between clients such as Claude Code, Codex, Cursor, OpenCode, Cline, Continue, Roo, and upstream providers such as Claude, Codex, Kiro, GLM, MiniMax, OpenRouter, and custom-compatible endpoints.

This fork is useful when you want:

- One local/self-hosted gateway for multiple AI clients.
- API keys that only expose the models they are allowed to use.
- Combo fallback lists that can target specific provider accounts.
- A fork workflow that tracks upstream releases without losing local changes.

## How This Fork Differs From Upstream

| Area | Upstream 9Router | This fork |
| --- | --- | --- |
| Project goal | Broad public gateway and dashboard | Local-first fork with stricter access control |
| API keys | General endpoint keys | Keys can restrict visible and usable models |
| Model listing | Broad model catalog by default | `/v1/models` can be filtered by key policy |
| Combos | Ordered fallback model lists | Combo entries can bind to provider accounts with `connectionId` |
| Release flow | Upstream release cadence | Fork releases use tags like `fork-v0.5.40` |

## Current Base

This fork is currently synced with upstream `decolua/9router` **v0.5.55**.

Current fork release:

```text
fork-v0.5.55
```

Fork releases use the upstream version as the base version, then prefix it with `fork-`.

## Features

Core 9Router features retained from upstream:

- OpenAI-compatible `/v1/*` API.
- Web dashboard for providers, aliases, combos, API keys, usage, pricing, and settings.
- Provider routing across OAuth, API-key, free, cheap, subscription, and custom-compatible providers.
- Ordered combo fallback, where one model name can try multiple provider models in sequence.
- Format translation across OpenAI-compatible, Claude, Gemini, Cursor, Kiro, and related provider formats.
- Token-saver support, including RTK-style tool output compression.
- SQLite-backed local persistence under `DATA_DIR`.
- Source and container-based self-hosting.

Fork-specific additions:

- API key `allowedModels` and `blockedModels` policy support.
- Policy-gated `/v1/models` responses for restricted keys.
- Combo-level access checks for restricted API keys.
- Per-model account binding in combos through `connectionId`.
- Repeatable fork sync and release naming conventions.
- Testing Studio at `/dashboard/playground` for authenticated streaming chats and side-by-side model comparisons.

## Testing Studio

Open `/dashboard/playground` from the dashboard sidebar. It replaces the legacy Basic Chat route, which redirects to the studio.

Testing Studio uses the authenticated dashboard chat endpoint and the models already available through your connected providers. It does not expose provider credentials to the browser. It currently accepts text prompts only; it does not attach or upload images.

The studio keeps its draft, selected models, presets, and recent sessions in versioned browser localStorage keys. Chat has one provider-type filter, and each Compare column has its own independent provider-type filter. These filters use the provider ID from each model's provider metadata, not a configured account. Filter choices are ephemeral and are not persisted. Selected model persistence remains unchanged, so a selected model can still be restored when the studio is remounted. Before display or storage, client-visible data is sanitized: credential-shaped fields and values are redacted, and large or deeply nested values are bounded. Provider connection details and raw stream events remain transient. Browser storage can be unavailable or full; in that case, the current session remains usable but later changes stay in memory only.

## Architecture at a Glance

```text
AI client / editor / agent
        |
        | OpenAI-compatible request
        v
9Router API and dashboard
        |
        | auth, model policy, combo resolution, account selection
        v
provider executor / translator
        |
        v
upstream model provider
```

Key code areas:

- `src/app/api/v1/*` and `src/app/api/v1beta/*` — OpenAI-compatible API routes.
- `src/app/api/keys*` — API key lifecycle and policy data.
- `src/app/api/combos*` — combo management.
- `src/sse/handlers/chat.js` — request parsing, combo handling, and account selection.
- `open-sse/` — provider execution, SSE streaming, and request/response translation.

For deeper internals, see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Quick Start

Install dependencies and run the development server:

```bash
npm install
npm run dev
```

Build and start a production build:

```bash
npm run build
PORT=20128 HOSTNAME=0.0.0.0 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run start
```

Default URLs:

- Dashboard: `http://localhost:20128/dashboard`
- OpenAI-compatible API: `http://localhost:20128/v1`

---

## Video Guides

<div align="center">

<table>
  <tr>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=X69n5Lm06Yw">
        <img src="https://img.youtube.com/vi/X69n5Lm06Yw/maxresdefault.jpg" alt="Tiết kiệm chi phí LLM với 9Router" width="300"/>
      </a><br/>
      <b>🇻🇳 Tiếng Việt</b><br/>
      <sub>Tiết kiệm chi phí LLM cho OpenClaw với 9Router<br/>by <a href="https://www.youtube.com/c/M%C3%ACAIblog">Mì AI</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://youtu.be/VQAw612S27Y">
        <img src="https://img.youtube.com/vi/VQAw612S27Y/maxresdefault.jpg" alt="9Router + Claude Code FREE Unlimited Setup" width="300"/>
      </a><br/>
      <b>🇵🇰 اردو / हिन्दी</b><br/>
      <sub>9Router + Claude Code FREE Unlimited Setup<br/>by <a href="https://www.youtube.com/@BuildAIWithHamid">Build AI With Hamid</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=raEyZPg5xE0">
        <img src="https://img.youtube.com/vi/raEyZPg5xE0/maxresdefault.jpg" alt="9Router Setup Tutorial" width="300"/>
      </a><br/>
      <b>🇺🇸 English</b><br/>
      <sub>9Router + Claude Code FREE Setup<br/>by <a href="https://www.youtube.com/@BuildAIWithHamid">Build AI With Hamid</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://youtu.be/3dF5GIYMrcQ?si=bAyfyiHbARJQAHj_">
        <img src="https://img.youtube.com/vi/3dF5GIYMrcQ/hqdefault.jpg" alt="9Router Setup Tutorial" width="300"/>
      </a><br/>
      <b>🇺🇸 English</b><br/>
      <sub>9Router + Claude Code FREE Setup<br/>by <a href="https://www.youtube.com/@BuildAIWithHamid">Build AI With Hamid</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=o3qYCyjrFYg">
        <img src="https://img.youtube.com/vi/o3qYCyjrFYg/maxresdefault.jpg" alt="Claude Code FREE Forever" width="300"/>
      </a><br/>
      <b>🇺🇸 English</b><br/>
      <sub>Claude Code FREE Forever — Unlimited Models<br/>by <a href="https://www.youtube.com/@BuildAIWithHamid">Build AI With Hamid</a></sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=Ttpc26m39Dw">
        <img src="https://img.youtube.com/vi/Ttpc26m39Dw/maxresdefault.jpg" alt="Claude CLI Free Setup" width="300"/>
      </a><br/>
      <b>🇺🇸 English</b><br/>
      <sub>Claude CLI Free Setup with 9Router 🚀<br/>by <a href="https://www.youtube.com/@CodeVerseSoban">CodeVerse Soban</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=G-5A_D5Pm6Y">
        <img src="https://img.youtube.com/vi/G-5A_D5Pm6Y/maxresdefault.jpg" alt="Cài đặt OpenClaw Free A-Z" width="300"/>
      </a><br/>
      <b>🇻🇳 Tiếng Việt</b><br/>
      <sub>Cài Đặt OpenClaw Free Từ A-Z + 9Router<br/>by <a href="https://www.youtube.com/@maigia">Mai Gia</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=JXmg8_gccgE">
        <img src="https://img.youtube.com/vi/JXmg8_gccgE/maxresdefault.jpg" alt="FREE OpenClaw with Claude Opus" width="300"/>
      </a><br/>
      <b>🇺🇸 English</b><br/>
      <sub>FREE OpenClaw + Claude Opus 4.6<br/>by <a href="https://www.youtube.com/@BuildAIWithHamid">Build AI With Hamid</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=CkVZZUSTXAI">
        <img src="https://img.youtube.com/vi/CkVZZUSTXAI/mqdefault.jpg" alt="Claude CLI Free Setup" width="300"/>
      </a><br/>
      <b>🇮🇩 Indonesia</b><br/>
      <sub>Koding 24 Jam Anti Rate Limit! Hemat Token AI 65% | Tutorial Quick Setup 9Router 🚀<br/>by <a href="https://www.youtube.com/@krisswuh">Krisswuh</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=TXGv4eofe1I">
        <img src="https://img.youtube.com/vi/TXGv4eofe1I/mqdefault.jpg" alt="Cara Deploy 9Router di Hugging Face GRATIS Non-Stop! | Alternatif VPS RAM 16GB" width="300"/>
      </a><br/>
      <b>🇮🇩 Indonesia</b><br/>
      <sub>Cara Deploy 9Router di Hugging Face GRATIS Non-Stop! | Alternatif VPS RAM 16GB<br/>by <a href="https://www.youtube.com/@krisswuh">Krisswuh</a></sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=GyX-DLvePW8">
        <img src="https://img.youtube.com/vi/GyX-DLvePW8/hqdefault.jpg" alt="این شکلی از هر API ای استفاده کن برای هوش مصنوعی" width="300"/>
      </a><br/>
      <b>🇮🇷 Persian-فارسی</b><br/>
      <sub dir="rtl">این شکلی از هر API ای استفاده کن برای هوش مصنوعی<br/>by <a href="https://www.youtube.com/@Matin_SenPai">Matin SenPai</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=hPusYX-5Pmw">
        <img src="https://img.youtube.com/vi/hPusYX-5Pmw/maxresdefault.jpg" alt="Hướng Dẫn Setup OpenClaw + 9Router: Tạo Bot Zalo AI Tự Động Từ A-Z" width="300"/>
      </a><br/>
      <b>🇻🇳 Tiếng Việt</b><br/>
      <sub>Hướng Dẫn Setup OpenClaw + 9Router: Tạo Bot Zalo AI Tự Động Từ A-Z<br/>by <a href="https://github.com/tuanminhhole">tuanminhhole</a></sub>
    </td>
    <td align="center" width="320"></td>
    <td align="center" width="320"></td>
    <td align="center" width="320"></td>
  </tr>
</table>

</div>

> 🎬 **Made a video about 9Router?** Submit a [Pull Request](https://github.com/decolua/9router/pulls) adding your video to this section — we'll merge it!

---

## 🛠️ Supported CLI Tools

9Router works seamlessly with all major AI coding tools:

<div align="center">
  <table>
    <tr>
      <td align="center" width="120">
        <img src="./public/providers/claude.png" width="60" alt="Claude Code"/><br/>
        <b>Claude-Code</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/openclaw.png" width="60" alt="OpenClaw"/><br/>
        <b>OpenClaw</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/codex.png" width="60" alt="Codex"/><br/>
        <b>Codex</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/opencode.png" width="60" alt="OpenCode"/><br/>
        <b>OpenCode</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/cursor.png" width="60" alt="Cursor"/><br/>
        <b>Cursor</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/antigravity.png" width="60" alt="Antigravity"/><br/>
        <b>Antigravity</b>
      </td>
    </tr>
    <tr>
      <td align="center" width="120">
        <img src="./public/providers/cline.png" width="60" alt="Cline"/><br/>
        <b>Cline</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/continue.png" width="60" alt="Continue"/><br/>
        <b>Continue</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/droid.png" width="60" alt="Droid"/><br/>
        <b>Droid</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/roo.png" width="60" alt="Roo"/><br/>
        <b>Roo</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/copilot.png" width="60" alt="Copilot"/><br/>
        <b>Copilot</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/kilocode.png" width="60" alt="Kilo Code"/><br/>
        <b>Kilo Code</b>
      </td>
    </tr>
    <tr>
      <td align="center" width="120">
        <img src="./public/providers/opendesign.png" width="60" alt="OpenDesign"/><br/>
        <b>OpenDesign</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/jcode.png" width="60" alt="jcode"/><br/>
        <b>jcode</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/grok-cli.png" width="60" alt="Grok Build"/><br/>
        <b>Grok Build</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/devin-cli.png" width="60" alt="Devin CLI"/><br/>
        <b>Devin CLI</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/deepseek-tui.png" width="60" alt="DeepSeek TUI"/><br/>
        <b>DeepSeek TUI</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/qwen.png" width="60" alt="Qwen Code"/><br/>
        <b>Qwen Code</b>
      </td>
    </tr>
  </table>
</div>

---

## 🌐 Supported Providers

### 🔐 OAuth Providers

<div align="center">
  <table>
    <tr>
      <td align="center" width="120">
        <img src="./public/providers/claude.png" width="60" alt="Claude Code"/><br/>
        <b>Claude-Code</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/antigravity.png" width="60" alt="Antigravity"/><br/>
        <b>Antigravity</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/codex.png" width="60" alt="Codex"/><br/>
        <b>Codex</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/github.png" width="60" alt="GitHub"/><br/>
        <b>GitHub</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/cursor.png" width="60" alt="Cursor"/><br/>
        <b>Cursor</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/kimchi.png" width="60" alt="Kimchi"/><br/>
        <b>Kimchi</b>
      </td>
    </tr>
  </table>
</div>

### 🆓 Free Providers

<div align="center">
  <table>
    <tr>
      <td align="center" width="150">
        <img src="./public/providers/kiro.png" width="70" alt="Kiro"/><br/>
        <b>Kiro AI</b><br/>
        <sub>Claude 4.5 + GLM-5 + MiniMax<br/>50 credits/month free</sub>
      </td>
      <td align="center" width="150">
        <img src="./public/providers/opencode.png" width="70" alt="OpenCode Free"/><br/>
        <b>OpenCode Free</b><br/>
        <sub>No auth • Auto-fetch models<br/>Free (model list varies)</sub>
      </td>
      <td align="center" width="150">
        <img src="./public/providers/gemini.png" width="70" alt="Vertex AI"/><br/>
        <b>Vertex AI</b><br/>
        <sub>Gemini 3 Pro + GLM-5 + DeepSeek<br/>$300 credits free</sub>
      </td>
    </tr>
  </table>
</div>

> **Note:** iFlow, Qwen Code and Gemini CLI free tiers were discontinued in 2026. Use Kiro / OpenCode Free / Vertex instead.
>
> **Kiro AI** moved to a paid model in Sep 2025 — the free tier is now capped at **50 credits/month** (plus 500 trial credits for new accounts in the first 30 days). Paid tiers: Pro $20/mo (1,000 credits), Pro+ $40/mo (2,000), Pro Max $100/mo (5,000), Power $200/mo (10,000).
> **OpenCode Free** model list fluctuates over time (some models free only for limited promos) — subject to change without notice.
> **Vertex AI**: the $300 free credit for new GCP accounts is still valid, but since Mar 2026 the **Gemini API endpoint no longer consumes these credits** — call the **Vertex AI Studio** endpoint instead.

### 🔑 API Key Providers (40+)

<div align="center">
  <table>
    <tr>
      <td align="center" width="100">
        <img src="./public/providers/openrouter.png" width="50" alt="OpenRouter"/><br/>
        <sub>OpenRouter</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/glm.png" width="50" alt="GLM"/><br/>
        <sub>GLM</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/kimi.png" width="50" alt="Kimi"/><br/>
        <sub>Kimi</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/minimax.png" width="50" alt="MiniMax"/><br/>
        <sub>MiniMax</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/openai.png" width="50" alt="OpenAI"/><br/>
        <sub>OpenAI</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/anthropic.png" width="50" alt="Anthropic"/><br/>
        <sub>Anthropic</sub>
      </td>
    </tr>
    <tr>
      <td align="center" width="100">
        <img src="./public/providers/gemini.png" width="50" alt="Gemini"/><br/>
        <sub>Gemini</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/deepseek.png" width="50" alt="DeepSeek"/><br/>
        <sub>DeepSeek</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/groq.png" width="50" alt="Groq"/><br/>
        <sub>Groq</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/xai.png" width="50" alt="xAI"/><br/>
        <sub>xAI</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/mistral.png" width="50" alt="Mistral"/><br/>
        <sub>Mistral</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/perplexity.png" width="50" alt="Perplexity"/><br/>
        <sub>Perplexity</sub>
      </td>
    </tr>
    <tr>
      <td align="center" width="100">
        <img src="./public/providers/together.png" width="50" alt="Together"/><br/>
        <sub>Together AI</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/fireworks.png" width="50" alt="Fireworks"/><br/>
        <sub>Fireworks</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/cerebras.png" width="50" alt="Cerebras"/><br/>
        <sub>Cerebras</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/cohere.png" width="50" alt="Cohere"/><br/>
        <sub>Cohere</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/nvidia.png" width="50" alt="NVIDIA"/><br/>
        <sub>NVIDIA</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/siliconflow.png" width="50" alt="SiliconFlow"/><br/>
        <sub>SiliconFlow</sub>
      </td>
    </tr>
  </table>
  <p><i>...and 20+ more providers including Nebius, Chutes, Hyperbolic, and custom OpenAI/Anthropic compatible endpoints</i></p>
</div>

### 🏠 Self-hosted Providers

For speech and embeddings served from **your own** machine — whisper.cpp,
faster-whisper, Speaches, Kokoro-FastAPI, openedai-speech, llama.cpp/llama-server,
vLLM, Infinity, text-embeddings-inference, or anything else that speaks the OpenAI
shape.

| Provider | Endpoint used | Typical server |
| --- | --- | --- |
| **Self-hosted STT** | `/v1/audio/transcriptions` | whisper.cpp, faster-whisper |
| **Self-hosted TTS** | `/v1/audio/speech` | Kokoro-FastAPI, openedai-speech |
| **Self-hosted Embedding** | `/v1/embeddings` | llama-server, vLLM, Infinity |

Every other speech provider is a named cloud service with a fixed endpoint. These
three read their address from **each connection**, so one provider can front
several machines and load-balance across them like any other.

Set it on the connection as `providerSpecificData.baseUrl`:

| Provider | Give it | Result |
| --- | --- | --- |
| Self-hosted STT | the full URL — `http://host:8080/v1/audio/transcriptions` | used as-is |
| Self-hosted TTS | the server root — `http://host:8880` | `+ /v1/audio/speech` |
| Self-hosted Embedding | the **OpenAI base**, `/v1` included — `http://host:8080/v1` | `+ /embeddings` |

> **Mind the `/v1` on embeddings.** The adapter appends `/embeddings`, so
> `http://host:8080` resolves to `http://host:8080/embeddings` and misses the
> OpenAI route — llama-server answers **501**. Give it the same base URL an OpenAI
> client would use. A full `.../v1/embeddings` is also accepted, so a value pasted
> from a `curl` example works too.

The API key is not checked by most local servers, but the field must be non-empty:
it is what gives the connection a credentials record, and `baseUrl` lives there.
Any placeholder works.

Self-hosted Embedding has **no cloud fallback by design** — a connection saved
without a `baseUrl` is reported as a configuration error rather than quietly
falling back to `api.openai.com`, which would send your input text and API key to
a third party under a provider named "Self-hosted".

---

## 💡 Key Features

| Feature                                                                           | What It Does                                                                             | Why It Matters                                    |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 🚀 **RTK Token Saver** ([RTK](https://github.com/rtk-ai/rtk) ⭐40K)               | Compress tool outputs (`git diff`, `grep`, `ls`, `tree`...) before sending to LLM        | Save **20-40% input tokens** per request          |
| 🧠 **Headroom Token Saver** ([Headroom](https://github.com/chopratejas/headroom)) | Optional external `/v1/compress` proxy before provider routing                           | Save more context tokens without changing clients |
| 🪨 **Caveman Mode** ([Caveman](https://github.com/JuliusBrussee/caveman) ⭐52K)   | Inject caveman-speak prompt → LLM replies terse, technical substance preserved           | Save **up to 65% output tokens**                  |
| 🐴 **Ponytail** ([Ponytail](https://github.com/DietrichGebert/ponytail))          | Inject "lazy senior dev" prompt → LLM writes minimal, YAGNI-first code (Lite/Full/Ultra) | **Fewer output tokens, less refactoring**         |
| 🎯 **Smart 3-Tier Fallback**                                                      | Auto-route: Subscription → Cheap → Free                                                  | Never stop coding, zero downtime                  |
| 📊 **Real-Time Quota Tracking**                                                   | Live token count + reset countdown                                                       | Maximize subscription value                       |
| 🔄 **Format Translation**                                                         | OpenAI ↔ Claude ↔ Gemini ↔ Cursor ↔ Kiro ↔ Vertex                                        | Works with any CLI tool                           |
| 👥 **Multi-Account Support**                                                      | Multiple accounts per provider                                                           | Load balancing + redundancy                       |
| 🔄 **Auto Token Refresh**                                                         | OAuth tokens refresh automatically                                                       | No manual re-login needed                         |
| 🎨 **Custom Combos**                                                              | Create unlimited model combinations                                                      | Tailor fallback to your needs                     |
| 📝 **Request Logging**                                                            | Debug mode with full request/response logs                                               | Troubleshoot issues easily                        |
| 💾 **Cloud Sync**                                                                 | Sync config across devices                                                               | Same setup everywhere                             |
| 📊 **Usage Analytics**                                                            | Track tokens, cost, trends over time                                                     | Optimize spending                                 |
| 🌐 **Deploy Anywhere**                                                            | Localhost, VPS, Docker, Cloudflare Workers                                               | Flexible deployment options                       |

Set `X-9Router-Token-Saver: off` to bypass all token savers for one chat request.

<details>
<summary><b>📖 Feature Details</b></summary>

### 🚀 RTK Token Saver

Tool outputs (`git diff`, `grep`, `find`, `ls`, `tree`, log dumps...) often eat 30-50% of your prompt budget. RTK detects them and applies smart, lossless compression **before** the request hits the LLM:

- **Filters:** `git-diff`, `git-status`, `grep`, `find`, `ls`, `tree`, `dedup-log`, `smart-truncate`, `read-numbered`, `search-list`
- **Auto-detect:** No config needed — RTK peeks the first 1KB of each `tool_result` and picks the right filter.
- **Safe by design:** If a filter fails, throws, or makes output bigger, RTK silently keeps the original text. Errors never break your request.
- **Universal:** Works across all formats (OpenAI, Claude, Gemini, Cursor, Kiro, OpenAI Responses) because it runs **before** any format translation.
- **Default ON:** Toggle anytime in Dashboard → Endpoint settings.

```
Without RTK: 47K tokens sent to LLM
With RTK:    28K tokens sent to LLM   (40% saved · same context · same answer)
```

### 🧠 Headroom Token Saver

Headroom is optional and runs separately. 9Router calls Headroom's local `/v1/compress` endpoint, then keeps normal routing, fallback, auth, and usage tracking:

```
Client → 9Router → Headroom /v1/compress → 9Router → provider
```

Local setup:

```bash
pip install "headroom-ai[proxy]"
headroom proxy --port 8787
```

Enable in Dashboard → Endpoint → Token Saver → Headroom. Default URL: `http://localhost:8787`.

Docker examples:

```bash
# Headroom service in same Docker network
http://headroom:8787

# Headroom running on host machine
http://host.docker.internal:8787
```

If Headroom is down or returns an error, 9Router fails open and sends the original request.

### 🐴 Ponytail (Lazy Senior Dev)

Ponytail injects a _"lazy senior dev"_ system prompt into every request, biasing the LLM toward minimal, YAGNI-first code — deletion over addition, stdlib over new deps, one-liners over abstractions. Adapted from [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail).

- **Lite** — Build what's asked, name the lazier alternative.
- **Full** — YAGNI ladder enforced: stdlib → native → existing deps → one-liner → minimal code.
- **Ultra** — YAGNI extremist: deletion first, ship the one-liner, challenge the rest of the requirement in the same response.

```
Without Ponytail: verbose code, extra abstractions, "just in case" scaffolding
With Ponytail:    shortest working diff, no unrequested abstractions, fewer tokens
```

Never trades away: input validation, error handling that prevents data loss, security, accessibility, or anything explicitly requested. Enable in Dashboard → Endpoint → Ponytail. Stacks with Caveman (output terseness) and RTK (input compression).

### 🎯 Smart 3-Tier Fallback

Create combos with automatic fallback:

```
Combo: "my-coding-stack"
  1. cc/claude-opus-4-6        (your subscription)
  2. glm/glm-4.7               (cheap backup, $0.6/1M)
  3. if/kimi-k2-thinking       (free fallback)

→ Auto switches when quota runs out or errors occur
```

### 📊 Real-Time Quota Tracking

- Token consumption per provider
- Reset countdown (5-hour, daily, weekly)
- Cost estimation for paid tiers
- Monthly spending reports

### 🔄 Format Translation

Seamless translation between formats:

- **OpenAI** ↔ **Claude** ↔ **Gemini** ↔ **Cursor** ↔ **Kiro** ↔ **Vertex** ↔ **Antigravity** ↔ **Ollama** ↔ **OpenAI Responses**
- Your CLI tool sends OpenAI format → 9Router translates → Provider receives native format
- Works with any tool that supports custom OpenAI endpoints

### 👥 Multi-Account Support

- Add multiple accounts per provider
- Auto round-robin or priority-based routing
- Fallback to next account when one hits quota

### 🔄 Auto Token Refresh

- OAuth tokens automatically refresh before expiration
- No manual re-authentication needed
- Seamless experience across all providers

### 🎨 Custom Combos

- Create unlimited model combinations
- Mix subscription, cheap, and free tiers
- Name your combos for easy access
- Share combos across devices with Cloud Sync

### 📝 Request Logging

- Enable debug mode for full request/response logs
- Track API calls, headers, and payloads
- Troubleshoot integration issues
- Export logs for analysis

### 💾 Cloud Sync

- Sync providers, combos, and settings across devices
- Automatic background sync
- Secure encrypted storage
- Access your setup from anywhere

#### Cloud Runtime Notes

- Prefer server-side cloud variables in production:
  - `BASE_URL` (internal callback URL used by sync scheduler)
  - `CLOUD_URL` (cloud sync endpoint base)
- `NEXT_PUBLIC_BASE_URL` and `NEXT_PUBLIC_CLOUD_URL` are still supported for compatibility/UI, but server runtime now prioritizes `BASE_URL`/`CLOUD_URL`.
- Cloud sync requests now use timeout + fail-fast behavior to avoid UI hanging when cloud DNS/network is unavailable.

### 📊 Usage Analytics

- Track token usage per provider and model
- Cost estimation and spending trends
- Monthly reports and insights
- Optimize your AI spending

> **💡 IMPORTANT - Understanding Dashboard Costs:**
>
> The "cost" displayed in Usage Analytics is **for tracking and comparison purposes only**.
> 9Router itself **never charges** you anything. You only pay providers directly (if using paid services).
>
> **Example:** If your dashboard shows "$290 total cost" while using Kiro free models, this represents
> what you would have paid using paid APIs directly. Your actual cost = **$0** (Kiro free tier: ~50 credits/mo).
>
> Think of it as a "savings tracker" showing how much you're saving by using free models or
> routing through 9Router!

### 🌐 Deploy Anywhere

- 💻 **Localhost** - Default, works offline
- ☁️ **VPS/Cloud** - Share across devices
- 🐳 **Docker** - One-command deployment
- 🚀 **Cloudflare Workers** - Global edge network

</details>

---

## 💰 Pricing at a Glance

| Tier                | Provider              | Cost         | Quota Reset      | Best For                                |
| ------------------- | --------------------- | ------------ | ---------------- | --------------------------------------- |
| **🚀 TOKEN SAVER**  | **RTK (built-in)**    | **FREE**     | Always on        | **Save 20-40% tokens on EVERY request** |
| **💳 SUBSCRIPTION** | Claude Code (Pro/Max) | $20-200/mo   | 5h + weekly      | Already subscribed                      |
|                     | Codex (Plus/Pro)      | $20-200/mo   | 5h + weekly      | OpenAI users                            |
|                     | GitHub Copilot        | $10-19/mo    | Monthly          | GitHub users                            |
|                     | Cursor IDE            | $20/mo       | Monthly          | Cursor users                            |
| **💰 CHEAP**        | GLM-5.1 / GLM-4.7     | $0.6/1M      | Daily 10AM       | Budget backup                           |
|                     | MiniMax M2.7          | $0.2/1M      | 5-hour rolling   | Cheapest option                         |
|                     | Kimi K2.5             | $9/mo flat   | 10M tokens/mo    | Predictable cost                        |
 | **🆓 FREE**         | Kiro AI               | $0           | 50 credits/mo    | Claude 4.5 + GLM-5 + MiniMax free (paid tiers above) |
 |                     | OpenCode Free         | $0           | Varies*          | No auth, auto-fetch models (list changes over time) |
 |                     | Vertex AI             | $300 credits | New GCP accounts | Gemini 3 Pro + DeepSeek + GLM-5 (use Vertex AI Studio endpoint for free credits) |

**💡 Pro Tip:** RTK + Kiro AI + OpenCode Free combo = **$0 cost + 20-40% token savings**!

---

### 📊 Understanding 9Router Costs & Billing

**9Router Billing Reality:**

✅ **9Router software = FREE forever** (open source, never charges)
✅ **Dashboard "costs" = Display/tracking only** (not actual bills)
✅ **You pay providers directly** (subscriptions or API fees)
✅ **FREE providers stay FREE** (Kiro ~50 credits/mo, OpenCode Free, Vertex $300 credits = $0 within free-tier limits) — note iFlow/Qwen/Gemini CLI free tiers were discontinued in 2026
❌ **9Router never sends invoices** or charges your card

**How Cost Display Works:**

The dashboard shows **estimated costs** as if you were using paid APIs directly. This is **not billing** - it's a comparison tool to show your savings.

**Example Scenario:**

```
Dashboard Display:
• Total Requests: 1,662
• Total Tokens: 47M
• Display Cost: $290

Reality Check:
• Provider: Kiro (free tier: ~50 credits/mo)
• Actual Payment: $0.00
• What $290 Means: Amount you SAVED by using free models!
```

**Payment Rules:**

- **Subscription providers** (Claude Code, Codex): Pay them directly via their websites
- **Cheap providers** (GLM, MiniMax): Pay them directly, 9Router just routes
- **FREE providers** (iFlow, Kiro, Qwen): Genuinely free forever, no hidden charges
- **9Router**: Never charges anything, ever

---

## 🎯 Use Cases

### Case 1: "I have Claude Pro subscription"

**Problem:** Quota expires unused, rate limits during heavy coding

**Solution:**

```
Combo: "maximize-claude"
  1. cc/claude-opus-4-7        (use subscription fully)
  2. glm/glm-5.1               (cheap backup when quota out)
  3. kr/claude-sonnet-4.5      (free emergency fallback)

Monthly cost: $20 (subscription) + ~$5 (backup) = $25 total
vs. $20 + hitting limits = frustration
```

### Case 2: "I want zero cost"

**Problem:** Can't afford subscriptions, need reliable AI coding

**Solution:**

```
Combo: "free-forever"
  1. kr/claude-sonnet-4.5      (Claude 4.5 free via Kiro, ~50 credits/mo)
  2. kr/glm-5                  (GLM-5 free via Kiro)
  3. oc/<auto>                 (OpenCode Free, no auth)

Monthly cost: $0
Quality: Production-ready models + RTK saves 20-40% tokens
```

### Case 3: "I need 24/7 coding, no interruptions"

**Problem:** Deadlines, can't afford downtime

**Solution:**

```
Combo: "always-on"
  1. cc/claude-opus-4-7        (best quality)
  2. cx/gpt-5.5                (second subscription)
  3. glm/glm-5.1               (cheap, resets daily)
  4. minimax/MiniMax-M2.7      (cheapest, 5h reset)
  5. kr/claude-sonnet-4.5      (free via Kiro, ~50 credits/mo)

Result: 5 layers of fallback = zero downtime
Monthly cost: $20-200 (subscriptions) + $10-20 (backup)
```

### Case 4: "I want FREE AI in OpenClaw"

**Problem:** Need AI assistant in messaging apps (WhatsApp, Telegram, Slack...), completely free

**Solution:**

```
Combo: "openclaw-free"
  1. kr/claude-sonnet-4.5      (Claude 4.5 free)
  2. kr/glm-5                  (GLM-5 free)
  3. kr/MiniMax-M2.5           (MiniMax free)

Monthly cost: $0
Access via: WhatsApp, Telegram, Slack, Discord, iMessage, Signal...
```

---

## ❓ Frequently Asked Questions

<details>
<summary><b>📊 Why does my dashboard show high costs?</b></summary>

The dashboard tracks your token usage and displays **estimated costs** as if you were using paid APIs directly. This is **not actual billing** - it's a reference to show how much you're saving by using free models or existing subscriptions through 9Router.

**Example:**

- **Dashboard shows:** "$290 total cost"
- **Reality:** You're using Kiro free models (~50 credits/mo)
- **Your actual cost:** **$0.00**
- **What $290 means:** Amount you **saved** by using free models instead of paid APIs!

The cost display is a "savings tracker" to help you understand your usage patterns and optimization opportunities.

</details>

<details>
<summary><b>💳 Will I be charged by 9Router?</b></summary>

**No.** 9Router is free, open-source software that runs on your own computer. It never charges you anything.

**You only pay:**

- ✅ **Subscription providers** (Claude Code $20/mo, Codex $20-200/mo) → Pay them directly on their websites
- ✅ **Cheap providers** (GLM, MiniMax) → Pay them directly, 9Router just routes your requests
- ❌ **9Router itself** → **Never charges anything, ever**

9Router is a local proxy/router. It doesn't have your credit card, can't send invoices, and has no billing system. It's completely free software.

</details>

<details>
<summary><b>🆓 Are FREE providers really unlimited?</b></summary>

**Mostly!** The current FREE providers (Kiro, OpenCode Free, Vertex) are genuinely free, but free tiers have limits:

These are free services offered by those respective companies:

- **Kiro AI**: ~50 credits/month free (plus 500 trial credits for new accounts in the first 30 days) via AWS Builder ID / Google / GitHub OAuth. Paid tiers available above that.
- **OpenCode Free**: No-auth passthrough proxy, models auto-fetched from `opencode.ai/zen/v1/models`. The free model list fluctuates over time (some models free only for limited promos) — subject to change without notice.
- **Vertex AI**: $300 free credits for new Google Cloud accounts (90 days). Since Mar 2026 the Gemini API endpoint no longer consumes these credits — use the **Vertex AI Studio** endpoint instead.

9Router just routes your requests to them - there's no "catch" or future billing from 9Router itself. They're truly free services, and 9Router makes them easy to use with fallback support.

**Discontinued free tiers (no longer recommended):**

- ❌ **iFlow**: Was free unlimited, now changed to paid (2026)
- ❌ **Qwen Code**: Free OAuth tier fully discontinued by Alibaba on 2026-04-15
- ❌ **Gemini CLI**: Service fully shut down by Google on 2026-06-18 (replaced by the closed-source Antigravity CLI). Discontinued — do not use.

</details>

<details>
<summary><b>💰 How do I minimize my actual AI costs?</b></summary>

**Free-First Strategy:**

1. **Start with 100% free combo:**

   ```
   1. kr/glm-5 (GLM-5 free via Kiro, ~50 credits/mo)
   2. OpenCode Free models (no auth, auto-fetched)
   3. Vertex AI Gemini 3 Pro (using the Vertex AI Studio endpoint with $300 credits)
   ```

   **Cost: $0/month** (within Kiro's free credit cap; OpenCode/Vertex subject to their free-tier limits)

2. **Add cheap backup** only if you need it:

   ```
   4. glm/glm-4.7 ($0.6/1M tokens)
   ```

   **Additional cost: Only pay for what you actually use**

3. **Use subscription providers last:**
   - Only if you already have them
   - 9Router helps maximize their value through quota tracking

**Result:** Most users can operate at $0/month using only free tiers!

</details>

<details>
<summary><b>📈 What if my usage suddenly spikes?</b></summary>

9Router's smart fallback prevents surprise charges:

**Scenario:** You're on a coding sprint and blow through your quotas

**Without 9Router:**

- ❌ Hit rate limit → Work stops → Frustration
- ❌ Or: Accidentally rack up huge API bills

**With 9Router:**

- ✅ Subscription hits limit → Auto-fallback to cheap tier
- ✅ Cheap tier gets expensive → Auto-fallback to free tier
- ✅ Never stop coding → Predictable costs

**You're in control:** Set spending limits per provider in dashboard, and 9Router respects them.

</details>

---

## 📖 Setup Guide

<details>
<summary><b>🔐 Subscription Providers (Maximize Value)</b></summary>

### Claude Code (Pro/Max)

```bash
Dashboard → Providers → Connect Claude Code
→ OAuth login → Auto token refresh
→ 5-hour + weekly quota tracking

Models:
  cc/claude-opus-4-7
  cc/claude-opus-4-6
  cc/claude-sonnet-4-6
  cc/claude-haiku-4-5-20251001
```

**Pro Tip:** Use Opus for complex tasks, Sonnet for speed. 9Router tracks quota per model!

### OpenAI Codex (Plus/Pro)

```bash
Dashboard → Providers → Connect Codex
→ OAuth login (port 1455)
→ 5-hour + weekly reset

Models:
  cx/gpt-5.5
  cx/gpt-5.4
  cx/gpt-5.3-codex
  cx/gpt-5.2-codex
```

### GitHub Copilot

```bash
Dashboard → Providers → Connect GitHub
→ OAuth via GitHub
→ Monthly reset (1st of month)

Models:
  gh/gpt-5.4
  gh/claude-opus-4.7
  gh/claude-sonnet-4.6
  gh/gemini-3.1-pro-preview
  gh/grok-code-fast-1
```

### Cursor IDE

```bash
Dashboard → Providers → Connect Cursor
→ OAuth login
→ Monthly subscription

Models:
  cu/claude-4.6-opus-max
  cu/claude-4.5-sonnet-thinking
  cu/gpt-5.3-codex
```

</details>

<details>
<summary><b>💰 Cheap Providers (Backup)</b></summary>

### GLM-5.1 / GLM-4.7 (Daily reset, $0.6/1M)

1. Sign up: [Zhipu AI](https://open.bigmodel.cn/)
2. Get API key from Coding Plan
3. Dashboard → Add API Key:
   - Provider: `glm`
   - API Key: `your-key`

**Use:** `glm/glm-5.1`, `glm/glm-5`, `glm/glm-4.7`

**Pro Tip:** Coding Plan offers 3× quota at 1/7 cost! Reset daily 10:00 AM.

### MiniMax M2.7 (5h reset, $0.20/1M)

1. Sign up: [MiniMax](https://www.minimax.io/)
2. Get API key
3. Dashboard → Add API Key

**Use:** `minimax/MiniMax-M2.7`, `minimax/MiniMax-M2.5`

**Pro Tip:** Cheapest option for long context (1M tokens)!

### Kimi K2.5 ($9/month flat)

1. Subscribe: [Moonshot AI](https://platform.moonshot.ai/)
2. Get API key
3. Dashboard → Add API Key

**Use:** `kimi/kimi-k2.5`, `kimi/kimi-k2.5-thinking`

**Pro Tip:** Fixed $9/month for 10M tokens = $0.90/1M effective cost!

</details>

<details>
<summary><b>🆓 FREE Providers (Recommended)</b></summary>

### Kiro AI (Claude 4.5 + GLM-5 + MiniMax FREE)

```bash
Dashboard → Connect Kiro
→ AWS Builder ID, AWS IAM Identity Center, Google, or GitHub
→ Unlimited usage

Models:
  kr/claude-sonnet-4.5
  kr/claude-haiku-4.5
  kr/glm-5
  kr/MiniMax-M2.5
  kr/qwen3-coder-next
  kr/deepseek-3.2
```

**Pro Tip:** Best free option for Claude. No API key, no payment, fully unlimited.

### OpenCode Free (No auth, auto-fetch models)

```bash
Dashboard → Connect OpenCode Free
→ No login required (passthrough proxy)
→ Models auto-fetched from opencode.ai/zen/v1/models
```

**Pro Tip:** Fastest setup. Just connect and start coding.

### Vertex AI ($300 free credits for new GCP accounts)

```bash
Dashboard → Connect Vertex AI
→ Upload Google Cloud Service Account JSON
→ Enable Vertex AI API in your GCP project

Models:
  vertex/gemini-3.1-pro-preview
  vertex/gemini-3-flash-preview
  vertex/gemini-2.5-flash

Vertex Partner (Anthropic / DeepSeek / GLM / Qwen via Vertex):
  vertex-partner/glm-5-maas
  vertex-partner/deepseek-v3.2-maas
  vertex-partner/qwen3-next-80b-a3b-thinking-maas
```

**Pro Tip:** New Google Cloud accounts get $300 credits free for 90 days. Plenty for daily coding.

</details>

<details>
<summary><b>🎨 Create Combos</b></summary>

### Example 1: Maximize Subscription → Cheap Backup

```
Dashboard → Combos → Create New

Name: premium-coding
Models:
  1. cc/claude-opus-4-7 (Subscription primary)
  2. glm/glm-5.1 (Cheap backup, $0.6/1M)
  3. minimax/MiniMax-M2.7 (Cheapest fallback, $0.20/1M)

Use in CLI: premium-coding

Monthly cost example (100M tokens):
  80M via Claude (subscription): $0 extra
  15M via GLM: $9
  5M via MiniMax: $1
  Total: $10 + your subscription
```

### Example 2: Free-Only (Zero Cost)

```
Name: free-combo
Models:
  1. kr/claude-sonnet-4.5 (Claude 4.5 free via Kiro, ~50 credits/mo)
  2. kr/glm-5 (GLM-5 free via Kiro)
  3. vertex/gemini-3.1-pro-preview ($300 free credits)

Cost: $0 forever (+ 20-40% token savings via RTK)!
```

</details>

<details>
<summary><b>🔧 CLI Integration</b></summary>

### Cursor IDE

```
Settings → Models → Advanced:
  OpenAI API Base URL: http://localhost:20128/v1
  OpenAI API Key: [from 9router dashboard]
  Model: cc/claude-opus-4-7
```

Or use combo: `premium-coding`

### Claude Code

Edit `~/.claude/config.json`:

```json
{
  "anthropic_api_base": "http://localhost:20128/v1",
  "anthropic_api_key": "your-9router-api-key"
}
```

### Codex CLI

```bash
export OPENAI_BASE_URL="http://localhost:20128"
export OPENAI_API_KEY="your-9router-api-key"

codex "your prompt"
```

### OpenClaw

**Option 1 — Dashboard (recommended):**

```
Dashboard → CLI Tools → OpenClaw → Select Model → Apply
```

**Option 2 — Manual:** Edit `~/.openclaw/openclaw.json`:

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "9router/kr/claude-sonnet-4.5"
      }
    }
  },
  "models": {
    "providers": {
      "9router": {
        "baseUrl": "http://127.0.0.1:20128/v1",
        "apiKey": "sk_9router",
        "api": "openai-completions",
        "models": [
          {
            "id": "kr/claude-sonnet-4.5",
            "name": "Claude Sonnet 4.5 (Kiro Free)"
          }
        ]
      }
    }
  }
}
```

> **Note:** OpenClaw only works with local 9Router. Use `127.0.0.1` instead of `localhost` to avoid IPv6 resolution issues.

### Cline / Continue / RooCode

```
Provider: OpenAI Compatible
Base URL: http://localhost:20128/v1
API Key: [from dashboard]
Model: cc/claude-opus-4-7
```

</details>

<details>
<summary><b>🚀 Deployment</b></summary>

### VPS Deployment

```bash
# Clone and install
git clone https://github.com/decolua/9router.git
cd 9router
npm install
npm run build

# Configure
export JWT_SECRET="your-secure-secret-change-this"
export INITIAL_PASSWORD="your-password"
export DATA_DIR="/var/lib/9router"
export PORT="20128"
export HOSTNAME="0.0.0.0"
export NODE_ENV="production"
export NEXT_PUBLIC_BASE_URL="http://localhost:20128"
export NEXT_PUBLIC_CLOUD_URL="https://9router.com"
export API_KEY_SECRET="endpoint-proxy-api-key-secret"
export MACHINE_ID_SALT="endpoint-proxy-salt"

# Start
npm run start
```

Useful package scripts:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local Next.js dev server. |
| `npm run build` | Build the production app. |
| `npm run start` | Start the built app. |
| `npm run cli:pack` | Build the CLI package. |

## API Key Model Policy

This fork supports model-scoped API keys. A key can be limited to specific models, providers, or combos, so sharing a key does not automatically expose every connected account.

Example policy intent:

- Allow one key to use only `kr/*` models.
- Allow another key to use cheaper fallback providers such as `glm/*` or `minimax/*`.
- Block subscription-backed models from shared keys.
- Keep older unrestricted keys backward compatible.

Policy-related fields include:

- `allowedModels`
- `blockedModels`
- `allowedCombos`
- scopes
- expiration metadata
- last-used metadata

The same policy affects model discovery. When a restricted key calls `/v1/models`, the response should only include models that key is allowed to use.

## Combo Account Binding

Combos remain ordered fallback lists, but this fork can bind a combo entry to a specific provider connection through `connectionId`.

That matters when the same provider has multiple connected accounts with different quotas, subscriptions, or trust levels. Instead of saying “use any account for this provider,” a combo can say “use this model through this exact connection.”

Think of a combo as a route list, and `connectionId` as the specific lane that route should use.

## Fork Sync and Release Flow

This fork tracks upstream through explicit sync branches.

Standard naming:

| Purpose | Pattern | Example |
| --- | --- | --- |
| Sync branch | `sync/upstream-vX.Y.Z` | `sync/upstream-v0.5.40` |
| Backup branch | `backup/master-before-sync-upstream-vX.Y.Z` | `backup/master-before-sync-upstream-v0.5.40` |
| Fork release tag | `fork-vX.Y.Z` | `fork-v0.5.40` |
| Fork release title | `Fork release vX.Y.Z` | `Fork release v0.5.40` |

High-level process:

1. Create a sync branch for the upstream version.
2. Merge upstream into that branch.
3. Build and test the branch.
4. Open a PR into fork `master`.
5. Create a backup branch from pre-merge `origin/master`.
6. Merge the PR.
7. Verify the deployed/runtime environment separately.
8. Publish a fork release tag.
9. Delete the merged sync branch, but keep the backup branch.

## Configuration

Important runtime settings:

| Variable | Purpose |
| --- | --- |
| `DATA_DIR` | App data directory; SQLite lives under this path. |
| `PORT` | App port. |
| `HOSTNAME` | Bind address. |
| `BASE_URL` | Server-side app URL. |
| `NEXT_PUBLIC_BASE_URL` | Browser-visible app URL. |
| `CLOUD_URL` | Cloud sync endpoint base URL. |
| `NEXT_PUBLIC_CLOUD_URL` | Browser-visible cloud sync URL. |
| `REQUIRE_API_KEY` | Require Bearer API keys for `/v1/*` routes. |
| `AUTH_COOKIE_SECURE` | Use secure cookies behind HTTPS. |
| `ENABLE_REQUEST_LOGS` | Enable request/translator logs. |
| `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` | Optional outbound proxy settings. |

Do not commit `.env` files or secrets.

## OpenAI-Compatible API

Chat completions:

```bash
curl http://localhost:20128/v1/chat/completions \
  -H 'Authorization: Bearer your-9router-api-key' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "your-model-or-combo",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
```

List models visible to the provided key:

```bash
curl http://localhost:20128/v1/models \
  -H 'Authorization: Bearer your-9router-api-key'
```

For restricted keys, the model list is intentionally filtered by policy.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — request lifecycle, routing, combo fallback, OAuth/token refresh, cloud sync, and data model.
- `docs/PRD-api-key-model-scope.md` — model policy design notes, if present in your checkout.
- Upstream README and docs remain the best source for broad provider setup and public marketing details.

## Upstream Credit

This fork is based on [`decolua/9router`](https://github.com/decolua/9router). Upstream provides the core dashboard, OpenAI-compatible router, provider integrations, token savers, combo routing, translations, and broad setup documentation.

Fork changes are maintained separately for local-first routing and access-control needs. When possible, upstream improvements are merged instead of reimplemented.

## License

MIT, following upstream 9Router. See [`LICENSE`](LICENSE).
