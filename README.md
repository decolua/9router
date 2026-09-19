<div align="center">

# 9Router — Serenhope Fork

**A private, self-hosted fork of [9Router](https://github.com/Decolua/9router): one OpenAI-compatible gateway for your AI coding tools, with per-key quotas, your own model names, and a side-by-side model comparison tool on top.**

English only. The UI is locked to the dark theme. This README describes **this** repository; upstream documentation lives at [9router.com](https://9router.com).

`Upstream base: v0.5.75 (merged 2026-09-13) · Fork releases: v0.5.70-Custom → v0.5.99-Custom`

</div>

---

## What this fork is

Upstream 9Router already routes one OpenAI-style request to dozens of providers with format translation, account rotation and quota tracking. This fork keeps all of that and adds the parts I needed for a shared, long-running instance: **issuing API keys that carry their own limits and lifetime**, **giving models my own names**, and **comparing models on the same prompt** — plus a long list of gateway fixes found by running it for real.

Every change is listed in [CHANGELOG.md](./CHANGELOG.md), and the dashboard renders it in a **Changelog** dialog: the fork's releases are grouped under *Contributed by Serenhope*, upstream's under *Official Releases (Decolua)*, one card per date. Works offline.

## What is added or changed here

### API keys are the unit of control
| | |
| --- | --- |
| **Token limit per key** | A key stops answering with HTTP `429` once it has spent its budget; usage is tracked live against the key. |
| **Auto-reset interval** | `5h`, `7d`, `14d`, `30d` or a custom interval such as `10h`. The interval field only appears once a limit is set, and a limit of `0` means unlimited. |
| **Allowed models** | A key can be locked to a list of models with exact names or wildcards (`claude-*`, `gpt-*`); anything else gets HTTP `403`, and `GET /v1/models` only lists the models that key may call. Models are picked in the same visual picker used for combos, never typed. |
| **Expiry** | Optional `expiresAt`; an expired key is refused with `403 API key has expired`. |
| **On/off switch** | Each key row has a toggle. A switched-off key is refused with `403 API key is disabled` on **every** endpoint — chat, embeddings, images, video, speech, transcription, search and web fetch — even while the gateway runs without required keys. |
| **Names and editing** | Key names are unique (creating or renaming a duplicate is rejected with a clear message), a key can be duplicated with its settings, and used tokens can be zeroed by hand. |

Before this fork's fixes, per-key limits were only enforced on the chat endpoint, and a disabled or over-quota key could still reach remote `/v1/*`. That is no longer the case.

### Custom Plugins (`FEATURE+`)
Extend and modify model capabilities on a per-model basis:
- **Image Vision**: converts image inputs into extracted text descriptions for models without native vision capability, enabling visual content processing in CLI tools and agents. Adds the Vision (👁️) badge.
- **Think Deeper**: injects step-by-step chain-of-thought reasoning directives before generating answers. Adds the Reasoning (🧠) and Think Deeper (💡) badges.
- **Uncensored Output**: injects an anti-refusal system directive, compelling the model to fulfill raw technical queries, security analysis, and uncensored answers directly. Adds the key off (🗝️/key_off) badge.

### Custom Models & Editor (`FEATURE+`)
Define a model of your own: give it a name, a context window, an optional system prompt, and a target model it actually runs on. The name is callable everywhere: CLI tools, combos, the API-key allow-list, exactly like a built-in model.

A custom name is presented as the model it is: the gateway rewrites the `model` field of **every outbound payload** (JSON body, each streamed chunk, Claude `message_start`, Responses events, cache hits), so `claude-sonnet-5` answers `claude-sonnet-5` and never leaks the target behind it. Furthermore, when a model is mapped in studio, the underlying target model is completely hidden from model listings and pickers. Custom providers can also carry custom cropped logos.

### Compare Models (`FEATURE+`)
Send one prompt to several models at once and compare cost, latency, time-to-first-token and output. Contenders stream live, can be stopped mid-flight, a model that returns nothing is reported as empty rather than winning, and provider failures surface one readable line with the raw payload behind it.

### Live Version & GitHub Updates
The dashboard automatically compares the running local checkout against upstream master and alerts when new commits or versions are available.

### Other differences worth knowing
- **MoonshotAI (Kimi)** is offered as a first-class "add provider" option next to the OpenAI- and Anthropic-compatible ones.
- **Custom node prefixes resolve everywhere**, including when a custom model's target is typed as `mynode/some-model`. Note that a prefix can never shadow a built-in provider alias (`kr` is Kiro, `cc` is Claude Code, …) — pick a prefix that does not collide.
- **Gateway robustness**: upstream bodies that ignore `stream`, mislabel JSON as an event stream, arrive as NDJSON, or speak Claude/Responses events are all decoded instead of hanging or 502-ing; those transport shapes no longer trip a credential's cooldown, and an HTTP `400` from a provider is treated as the caller's mistake rather than grounding the account.
- **Removed from this fork**: the Model Masking page, Live Feed, Budget Groups, the PRD Document Writer, the Provider Health board, the theme switcher, the language switcher, and the dashboard's "change the default password" nag (`GET /api/health` is still the anonymous `{"ok":true}` probe that tunnel and uptime checks rely on).
- **UI**: dark mode only, English only, no theme or language controls, a GitHub button in the header, and icons that finally honour their declared size (the vendor icon stylesheet used to force every icon to 24px).
- **Dashboard login default password** is `seren123`.

## Quick start

This repository is the app itself (`9router-app`, private, not published to npm — upstream ships the `9router` CLI). Run it from source or from Docker.

```bash
cp .env.example .env        # optional, sensible defaults exist
npm install
npm run dev                  # dashboard on http://localhost:20127
```

Production:

```bash
npm run build                # next build --webpack
npm run start                # node custom-server.js --port 20127
```

Docker (listens on `20128`):

```bash
docker build -t 9router-fork .
docker run -d -p 20128:20128 -v 9router-data:/app/data 9router-fork
```

- Dashboard: `http://localhost:20127/dashboard` — first login uses `seren123` (or `INITIAL_PASSWORD`); change it before allowing remote access.
- OpenAI-compatible endpoint: `http://localhost:20127/v1`
- Claude-compatible endpoint: `http://localhost:20127/v1/messages`
- Gemini-native endpoint: `http://localhost:20127/v1beta/models/{model}:generateContent`
- Liveness probe: `GET /api/health` → `{"ok":true}` (no auth, CORS `*`)

Then: **Providers → Add provider** (or the OAuth flows upstream supports), copy an API key from **Endpoint & Key**, and point your tool at the base URL.

## Model names you can call

| Form | Example | Notes |
| --- | --- | --- |
| built-in provider | `kiro/claude-sonnet-4-5` | provider id or alias from the registry |
| custom node prefix | `mynode/gpt-oss-120b` | prefix defined on a self-added OpenAI/Anthropic-compatible node |
| combo | `my-combo` | fallback, round-robin, fusion and more strategies |
| custom model | `claude-sonnet-5` | defined in Custom Models & Editor; answers as itself |

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` / `HOSTNAME` | `20127` / framework default | bind port and host (`20128` in the Docker image) |
| `DATA_DIR` | `~/.9router` | SQLite database, backups, jwt secret, machine id |
| `INITIAL_PASSWORD` | `seren123` | first dashboard login when no password is stored |
| `JWT_SECRET` | auto (`$DATA_DIR/jwt-secret`) | dashboard session signing key |
| `BASE_URL` | local | externally reachable base URL; OAuth callbacks and tunnels derive from it |
| `API_KEY_SECRET` | built-in | HMAC secret behind generated `sk-` keys |
| `ENABLE_REQUEST_LOGS` | `false` | request/response logs under `logs/` |
| `AUTH_COOKIE_SECURE` | `false` | set behind HTTPS |
| `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY` | empty | outbound proxy for upstream calls |
| `SEARXNG_URL` | `http://localhost:8888/search` | built-in web-search provider |

Whether a request needs an API key at all is a dashboard setting (**Require API key**), not an environment variable.

State lives in `$DATA_DIR/db/data.sqlite`; lightweight backups are kept in `$DATA_DIR/db/backups/`. **Settings → Download Backup / Import Backup** round-trip providers, nodes, keys (limits, allow-lists and the enabled state), combos, custom models, overrides, pricing and usage — restoring a backup does not silently reset a key's quota.

## Development

```bash
npm install                                # app dependencies
cd tests && npm install && npx vitest run  # unit + translator suites
npx eslint src/sse/handlers/chat.js        # flat config: pass the files you touched
```

- Layout and conventions: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md), plus `AGENTS.md` files inside `open-sse/` and other subsystems.
- The gateway pipeline is `open-sse/` (provider-agnostic SSE engine); `src/sse/` is the Next.js-facing handler layer; `src/lib/db/` is the SQLite layer with additive schema sync and versioned migrations.
- Some tests in the repository are live/network tests or assert on files this fork deliberately removed; they fail in a plain checkout and are unrelated to a change unless they touch the same files.

## Staying in sync with upstream

Upstream moves fast, so the fork merges it rather than forking permanently:

```bash
git remote add upstream https://github.com/Decolua/9router.git
git fetch upstream master
git merge upstream/master
```

The same handful of files usually need a hand merge, and both sides are worth keeping: `src/lib/auth/dashboardSession.js` (fork password vs upstream session lifetime), `src/app/api/oauth/[provider]/[action]/route.js` (fork's forwarded-host callback detection vs upstream's new provider flows), `src/shared/components/ModelSelectModal.js`, and `CHANGELOG.md`. After a merge, compare the failing-test list against the pre-merge tree — upstream occasionally adds a test written for a different runner or an expectation its own code no longer meets.

## Credits & licence

- Everything this fork builds on is **[Decolua/9router](https://github.com/Decolua/9router)** — its authors keep full credit for the router, providers, translators and the whole upstream history.
- The fork's own contributions are marked **Contributed by Serenhope** in the changelog.
- License: **MIT**, as upstream. See [LICENSE](./LICENSE).
