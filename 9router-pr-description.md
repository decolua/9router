# 🙏 Add OmniRoute to README — A Fork That Grew Thanks to 9Router

## 👋 Hey decolua!

I just want to start by saying **thank you**. Genuinely.

When I found 9Router, I was looking for an AI proxy that was elegant, well-built, and developer-friendly. Your project was exactly that. The combo system, the auto-fallback, the clean Next.js dashboard — everything just clicked. I forked it planning to make "a few tweaks" for my workflow. That was months ago.

Those "few tweaks" turned into **[OmniRoute](https://github.com/diegosouzapw/OmniRoute)** — a full 100% TypeScript rewrite with 36+ providers, multi-modal APIs, circuit breakers, semantic cache, and 368+ unit tests. The project grew way beyond what I imagined, but at its core, **every single feature was built on the foundation you created**.

I want to be transparent: **OmniRoute descends directly from 9Router**. This isn't a "inspired by" situation — your code was literally the starting point, and I'm proud of that lineage. That's why your project is prominently credited in our README:

> - **Support section**: [9router by decolua](https://github.com/decolua/9router)
> - **Acknowledgments**: _"Special thanks to 9router by decolua — the original project that inspired this fork. OmniRoute builds upon that incredible foundation with additional features, multi-modal APIs, and a full TypeScript rewrite."_

---

## 🤝 The Ask

Would you be open to adding OmniRoute to your README? Something simple — maybe a "Forks & Derivatives" section, or just a mention in the Acknowledgments area. I realize the 9Router README doesn't have a section like CLIProxyAPI's "More Choices", but even a single line would mean a lot.

**Suggested entry:**

> ### 🚀 Fork
>
> **[OmniRoute](https://github.com/diegosouzapw/OmniRoute)** — A full-featured fork of 9Router, rewritten to 100% TypeScript. Adds 36+ providers, 4-tier auto-fallback, multi-modal APIs (images, embeddings, audio, TTS, moderations, reranking), circuit breaker, semantic cache, TLS fingerprint spoofing, anti-thundering herd, LLM evaluations, 6 combo routing strategies, thinking budget control, and a polished dashboard with translator playground, health monitoring, cost tracking, and onboarding wizard. 368+ unit tests. Available via npm (`omniroute`), Docker Hub, and VPS deployment. 217 additional features planned.

---

## 💡 What OmniRoute Added on Top of 9Router

Here's a quick overview of what we built on your foundation:

| Area                   | What We Added                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| **Providers**          | Grew from ~10 to **36+** (NVIDIA NIM, DeepSeek, Groq, xAI, Mistral, OpenRouter, and more)   |
| **Fallback**           | Added **API Key tier** (now 4-tier: Subscription → API Key → Cheap → Free)                  |
| **Combo Strategies**   | Added 5 more: round-robin, P2C, random, least-used, cost-optimized                          |
| **Format Translation** | Added **5th format** (Cursor) + sanitization, role normalization, think-tag extraction      |
| **Multi-Modal**        | 🆕 Images, Embeddings, Audio, TTS, Moderations, Reranking (6 new API endpoints)             |
| **Resilience**         | 🆕 Circuit breaker, semantic cache, anti-thundering herd, TLS spoofing, request idempotency |
| **Observability**      | 🆕 Health dashboard, LLM evaluations, cost tracking, latency telemetry (p50/p95/p99)        |
| **Dashboard**          | 🆕 Translator playground (4 modes), onboarding wizard, CLI tools dashboard, DB backups      |
| **TypeScript**         | Rewrote to **100%** TypeScript coverage                                                     |
| **Tests**              | Built **368+ unit tests**                                                                   |
| **CI/CD**              | GitHub Actions with auto npm publish + Docker Hub on release                                |
| **Docs**               | Multilingual README (8 languages), OpenAPI spec, full user guide                            |
| **Roadmap**            | **217 detailed feature specs** written for upcoming releases                                |

---

## 📸 Screenshots

| Page           | Preview                                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| **Main**       | ![Main](https://raw.githubusercontent.com/diegosouzapw/OmniRoute/main/docs/screenshots/MainOmniRoute.png)       |
| **Providers**  | ![Providers](https://raw.githubusercontent.com/diegosouzapw/OmniRoute/main/docs/screenshots/01-providers.png)   |
| **Analytics**  | ![Analytics](https://raw.githubusercontent.com/diegosouzapw/OmniRoute/main/docs/screenshots/03-analytics.png)   |
| **Health**     | ![Health](https://raw.githubusercontent.com/diegosouzapw/OmniRoute/main/docs/screenshots/04-health.png)         |
| **Translator** | ![Translator](https://raw.githubusercontent.com/diegosouzapw/OmniRoute/main/docs/screenshots/05-translator.png) |

---

## 🙏 Final Words

9Router wasn't just a codebase I forked — it was a **masterclass in how to build a clean, functional AI proxy**. The combo system, the provider abstraction, the Next.js architecture — that's all you. Everything I built was possible because you built something worth building on.

Whether or not this PR gets merged, I wanted you to know: your work matters, and it lives on in OmniRoute. Thank you for sharing it with the community. 🎉

**Links:**

- 🌐 Website: [omniroute.online](https://omniroute.online)
- 📦 npm: [`omniroute`](https://www.npmjs.com/package/omniroute)
- 🐳 Docker: [`diegosouzapw/omniroute`](https://hub.docker.com/r/diegosouzapw/omniroute)
- 📖 GitHub: [diegosouzapw/OmniRoute](https://github.com/diegosouzapw/OmniRoute)
