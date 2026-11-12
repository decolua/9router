# 9Router — Agent Skills

Drop-in skills for any AI agent (Claude, Cursor, ChatGPT, custom SDK). Just **copy a link** below and paste it to your AI — it will fetch the skill and use 9Router for you.

> Tip: start with the **9router** entry skill — it covers setup and links to all capability skills.

All copy-links point at this fork's `federation` branch
(`totalwindupflightsystems/9router`), which is where the skills below are
maintained. Skills built by upstream 9Router are also reachable upstream, but
the federation, docker-compose, multimodal and token-saving skills **exist only
in this fork** and 404 on `decolua/9router`.

## Skills

| Capability | Copy link below and paste to your AI |
|---|---|
| **Entry / Setup** (start here) | https://raw.githubusercontent.com/totalwindupflightsystems/9router/refs/heads/federation/skills/9router/SKILL.md |
| Chat / code-gen | https://raw.githubusercontent.com/totalwindupflightsystems/9router/refs/heads/federation/skills/9router-chat/SKILL.md |
| Image generation | https://raw.githubusercontent.com/totalwindupflightsystems/9router/refs/heads/federation/skills/9router-image/SKILL.md |
| Video generation (xAI Grok Imagine) | https://raw.githubusercontent.com/totalwindupflightsystems/9router/refs/heads/federation/skills/9router-video/SKILL.md |
| Text-to-speech | https://raw.githubusercontent.com/totalwindupflightsystems/9router/refs/heads/federation/skills/9router-tts/SKILL.md |
| Speech-to-text | https://raw.githubusercontent.com/totalwindupflightsystems/9router/refs/heads/federation/skills/9router-stt/SKILL.md |
| Embeddings | https://raw.githubusercontent.com/totalwindupflightsystems/9router/refs/heads/federation/skills/9router-embeddings/SKILL.md |
| Web search | https://raw.githubusercontent.com/totalwindupflightsystems/9router/refs/heads/federation/skills/9router-web-search/SKILL.md |
| Web fetch (URL → markdown) | https://raw.githubusercontent.com/totalwindupflightsystems/9router/refs/heads/federation/skills/9router-web-fetch/SKILL.md |
| Multimodal cookbook — images + audio + search in one flow **(fork-only)** | https://raw.githubusercontent.com/totalwindupflightsystems/9router/refs/heads/federation/skills/9router-multimodal/SKILL.md |
| Federation (edge → central proxying, replication, failover) **(fork-only)** | https://raw.githubusercontent.com/totalwindupflightsystems/9router/refs/heads/federation/skills/9router-federation-usage/SKILL.md |
| Deploy with docker compose — standalone, local build, federation stacks **(fork-only)** | https://raw.githubusercontent.com/totalwindupflightsystems/9router/refs/heads/federation/skills/9router-compose/SKILL.md |
| Token saving (RTK) + combo fallback + usage accounting **(fork-only)** | https://raw.githubusercontent.com/totalwindupflightsystems/9router/refs/heads/federation/skills/9router-token-saving-and-accounting-usage/SKILL.md |
| Model combos (chains, round-robin, nesting, per-key restriction) | https://raw.githubusercontent.com/totalwindupflightsystems/9router/refs/heads/federation/skills/9router-combos/SKILL.md |

## How to use

Paste to your AI (Claude, Cursor, ChatGPT, …):

```
Read this skill and use it: https://raw.githubusercontent.com/totalwindupflightsystems/9router/refs/heads/federation/skills/9router/SKILL.md
```

Then ask normally — *"generate an image of a cat"*, *"transcribe this URL"*, etc.

## Configure your shell once

```bash
export NINEROUTER_URL="http://localhost:20128"   # local default, or your VPS / tunnel URL
export NINEROUTER_KEY="sk-..."                   # from Dashboard → Keys (only if requireApiKey=true)
```

Verify: `curl $NINEROUTER_URL/api/health` → `{"ok":true}`.

## Links

- Source (this fork): https://github.com/totalwindupflightsystems/9router/tree/federation
- Upstream project (from which this repository forks): https://github.com/decolua/9router
- Dashboard: https://9router.com
