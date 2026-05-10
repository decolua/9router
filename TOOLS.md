# TOOLS.md - 9Router Local Notes

Ghi chú môi trường & công cụ specific cho dự án 9Router.

---

## Development Environment

- **Workspace:** `/root/.openclaw/workspace/projects/9router/`
- **Dashboard URL:** `http://localhost:20128`
- **Node:** v22.22.2

---

## Quick Commands

```bash
# Development
npm run dev              # Next.js dev (port 20128)
npm run dev:bun          # Bun dev mode
npm run build            # Production build
npm start                # Production server

# Docker
docker build -t 9router .
docker run -p 20128:20128 9router
```

---

## Key Directories

| Path | Mô tả |
|------|-------|
| `src/` | Source code chính |
| `src/app/api/` | API routes (proxy, providers) |
| `public/` | Static assets |
| `docs/` | Documentation |
| `tests/` | Test files |
| `scripts/` | Build/deploy scripts |

---

## Providers & Models

- **Provider config:** `9router` auth profile trong openclaw.json
- **Base URL:** `http://10.0.0.101:3000/v1`
- **Models:** openclaw-coder, openclaw-data, openclaw-free

---

## Database

- **Type:** SQLite
- **Libraries:** better-sqlite3 (primary), sql.js (fallback)
- **Location:** Runtime-generated (không commit)

---

## Deployment

- **Method:** Docker + CapRover
- **Config:** `captain-definition`, `diepxuan.config.mjs`
- **Server:** Tự xác định từ config deploy

---

## Testing Notes

- Test RTK compression: verify không mất context quan trọng
- Test fallback: provider fail → next provider
- Test quota: tracking chính xác, auto-refresh đúng timing
- Test multi-account: round-robin phân phối đều

---

Thêm ghi chú môi trường mới vào file này khi phát hiện.
