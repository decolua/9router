# 10router — Agent Skills

Drop-in skills for any AI agent (Claude, Cursor, ChatGPT, custom SDK). Just **copy a link** below and paste it to your AI — it will fetch the skill and use 10router for you.

> Tip: start with the **10router** entry skill — it covers setup and links to all capability skills.

## Skills

| Capability | Copy link below and paste to your AI |
|---|---|
| **Entry / Setup** (start here) | https://raw.githubusercontent.com/some-du6e/10router/refs/heads/master/skills/10router/SKILL.md |
| Chat / code-gen | https://raw.githubusercontent.com/some-du6e/10router/refs/heads/master/skills/10router-chat/SKILL.md |
| Image generation | https://raw.githubusercontent.com/some-du6e/10router/refs/heads/master/skills/10router-image/SKILL.md |
| Video generation (xAI Grok Imagine) | https://raw.githubusercontent.com/some-du6e/10router/refs/heads/master/skills/10router-video/SKILL.md |
| Text-to-speech | https://raw.githubusercontent.com/some-du6e/10router/refs/heads/master/skills/10router-tts/SKILL.md |
| Speech-to-text | https://raw.githubusercontent.com/some-du6e/10router/refs/heads/master/skills/10router-stt/SKILL.md |
| Embeddings | https://raw.githubusercontent.com/some-du6e/10router/refs/heads/master/skills/10router-embeddings/SKILL.md |
| Web search | https://raw.githubusercontent.com/some-du6e/10router/refs/heads/master/skills/10router-web-search/SKILL.md |
| Web fetch (URL → markdown) | https://raw.githubusercontent.com/some-du6e/10router/refs/heads/master/skills/10router-web-fetch/SKILL.md |

## How to use

Paste to your AI (Claude, Cursor, ChatGPT, …):

```
Read this skill and use it: https://raw.githubusercontent.com/some-du6e/10router/refs/heads/master/skills/10router/SKILL.md
```

Then ask normally — *"generate an image of a cat"*, *"transcribe this URL"*, etc.

## Configure your shell once

```bash
export TENROUTER_URL="http://localhost:20128"   # local default, or your VPS / tunnel URL
export TENROUTER_KEY="sk-..."                   # from Dashboard → Keys (only if requireApiKey=true)
```

> The legacy `NINEROUTER_URL` / `NINEROUTER_KEY` names still work as a fallback, but prefer the `TENROUTER_*` names above.

Verify: `curl $TENROUTER_URL/api/health` → `{"ok":true}`.

## Links

- Source: https://github.com/some-du6e/10router
- Dashboard: http://localhost:20128/dashboard (your own instance)
