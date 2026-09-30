<div align="center">

<img src="https://capsule-render.vercel.app/api?type=venom&height=200&color=0:f97815,100:c2590a&text=9Router&fontSize=60&fontColor=ffffff&fontAlignY=38&animation=fadeIn" width="100%" alt="9Router" />

<img src="https://readme-typing-svg.demolab.com?font=Inter&weight=600&size=20&duration=3500&pause=1200&color=F97815&center=true&vCenter=true&width=640&height=50&lines=One+gateway%2C+any+model;OpenAI%E2%80%91compatible+endpoint;Speaks+Claude+and+Gemini+too;Extra+features%2C+free+for+everyone" alt="One gateway, any model" />

A fork of [Decolua/9router](https://github.com/Decolua/9router) with extra features for everyone who wants them.

One gateway, one API key, any model: an OpenAI-compatible endpoint that routes to Claude, GPT, Gemini, Kimi, Qwen, GLM, DeepSeek, Grok and many more, with OAuth or your own accounts. This is still that router, with the parts I use daily changed and the rough edges fixed, free for anyone to use.

![License](https://img.shields.io/badge/license-MIT-green) ![Upstream](https://img.shields.io/badge/upstream-Decolua%2F9router-blue) ![Release](https://img.shields.io/badge/releases-v0.5.x--Custom-orange)

</div>

---

## Screenshots

<div align="center">

<img src="images/9router.png" alt="9Router dashboard" width="100%" />

</div>

## What it routes

The gateway accepts a request in OpenAI, Claude or Gemini shape, translates it to whatever the target provider speaks, and streams the answer back. Providers are grouped by how you sign in:

| Sign-in | Providers |
| --- | --- |
| OAuth | Claude, OpenAI Codex, Gemini CLI, Antigravity, Kiro, Kimi (Moonshot), Grok CLI, xAI, Cursor, GitHub Copilot, GitLab, Windsurf, Trae, Zed, iFlow, Qoder, Cline, KiloCode, CodeBuddy, Xiaomi MIMO |
| API key | OpenAI, Anthropic, DeepSeek, GLM (Z.ai / Zhipu), MiniMax, Mistral, Perplexity, Groq, Together, Fireworks, Cerebras, SambaNova, SiliconFlow, Nebius, Hugging Face, Venice, Voyage and dozens more |
| Free tier | OpenRouter, OpenCode, Kiro, Gemini, Cloudflare AI, NVIDIA, Morph, Poolside, Kimchi, LLM7, api-airforce |
| Web cookie | DeepSeek Web, Gemini Web, Kimi Web |
| Local | Ollama, LM Studio style self-hosted nodes, self-hosted TTS/STT/embeddings |

It is not only chat. The same gateway also serves text to image, image to text, video generation, text to speech, speech to text, embeddings, web search and web fetch, each with its own `/v1`-style endpoint.

## What this fork adds

Everything below lives alongside upstream's features and is documented in the [changelog](./CHANGELOG.md).

**Per-key control.** Every generated key can carry its own token limit, auto-reset interval, expiry, model allow-list (with wildcards) and on/off switch. Limits are enforced on every endpoint, not just chat.

**Custom Models.** Define a model with your own name that answers as itself; the target behind it never leaks into responses or listings. Custom providers can carry their own logo.

**Custom Plugins.** Four per-model plugins: Image Vision (text extraction for models without vision), Think Deeper (forced deep reasoning), Speed Mode (skips thinking for faster answers) and Uncensored Output (direct technical answers). Selected models show a badge.

**Compare Models.** Send one prompt to up to four models and compare speed, cost and output side by side, streaming live.

**Token Saver.** Compresses request context before it goes upstream, so long agent sessions spend fewer tokens.

**Automatic Backup.** The database can back itself up on a schedule (24 hours, 7 days, 30 days or custom) to a Telegram bot or a GitHub repository, with a live countdown. Manual Download Backup lets you pick which sections to include and shows each section's size.

**Update checks.** The dashboard compares your checkout against this repository and tells you when new commits are available, with a one-click auto updater on CLI installs.

## Getting started

```bash
git clone https://github.com/serenhope/9router.git
cd 9router
npm install
npm run dev          # dashboard on http://localhost:20127
```

Production:

```bash
npm run build
npm run start
```

Docker:

```bash
docker build -t 9router-fork .
docker run -d -p 20128:20128 -v 9router-data:/app/data 9router-fork
```

Once it is running:

| | |
| --- | --- |
| Dashboard | `http://localhost:20127/dashboard` (first login: `seren123`, or set `INITIAL_PASSWORD`) |
| OpenAI-compatible | `http://localhost:20127/v1` |
| Claude-compatible | `http://localhost:20127/v1/messages` |
| Gemini-native | `http://localhost:20127/v1beta/models/{model}:generateContent` |
| Health probe | `GET /api/health` |

Point any CLI tool or agent at the base URL, generate a key under **Endpoint & Key**, and you are done.

## Model names you can call

| Form | Example |
| --- | --- |
| Provider model | `kiro/claude-sonnet-4.5`, `kimi/kimi-k2.6`, `deepseek/deepseek-v4.1-pro` |
| Custom node | `mynode/gpt-oss-120b` |
| Combo | `my-combo` (fallback, round-robin, fusion and more) |
| Custom model | any name you define in Custom Models |

## Configuration

The app reads a few environment variables with sensible defaults; see [.env.example](./.env.example). State lives in `~/.9router` (SQLite database, backups, secrets).

## Credits

- Built on **[Decolua/9router](https://github.com/Decolua/9router)** — full credit to upstream for the router, the providers and the translators.
- Fork releases are tagged in [CHANGELOG.md](./CHANGELOG.md).
- License: **MIT**, same as upstream. See [LICENSE](./LICENSE).

---

<div align="center">

If this fork helped you, a star is appreciated.

[![Stars](https://img.shields.io/github/stars/serenhope/9router?style=social)](https://github.com/serenhope/9router/stargazers)

</div>

<img src="https://capsule-render.vercel.app/api?type=waving&section=footer&height=140&color=0:c2590a,50:f97815,100:ffb347&animation=fadeIn" width="100%" alt="" />
