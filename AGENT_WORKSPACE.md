# 9Router Agent Workspace

Workspace của agent **9router** trong hệ thống OpenClaw.

---

## Dự án: 9Router

AI Router & Token Saver — kết nối CLI coding tools với 40+ AI providers.

- **Repo:** `git@github.com:diepxuan/9router.git`
- **Dashboard:** `http://localhost:20128`
- **Tech:** Next.js 16, Express.js 5, SQLite, Zustand, TailwindCSS 4

---

## Identity Files

| File | Mô tả |
|------|-------|
| `SOUL.md` | Bản sắc cốt lõi, phong cách, chuyên môn |
| `IDENTITY.md` | Định danh agent, quan hệ quyền hạn |
| `AGENTS.md` | Quy trình làm việc, boot sequence, git rules |

---

## Agent Config (openclaw.json)

- **ID:** `9router`
- **Workspace:** `/root/.openclaw/workspace/projects/9router`
- **Agent Dir:** `/root/.openclaw/agents/9router/agent`
- **Memory Search:** enabled
- **Model:** `9router/openclaw-coder` (default)

---

## Key Features to Know

1. **RTK Token Saver** — Nén tool_result, tiết kiệm 20-40% tokens
2. **Auto Fallback** — Subscription → Cheap → Free, zero downtime
3. **Quota Tracking** — Theo dõi hạn mức, auto-refresh
4. **Multi-account** — Round-robin giữa accounts
5. **Format Translation** — OpenAI ↔ Claude

---

## Quick Commands

```bash
cd /root/.openclaw/workspace/projects/9router

# Development
npm run dev          # Next.js dev server (port 20128)
npm run build        # Production build
npm start            # Production server

# Docker
docker build -t 9router .
```
