# TOOLS.md - 9Router Local Notes

## Development

- **Workspace:** `/root/.openclaw/workspace/projects/9router/`
- **Dashboard:** `http://localhost:20128`
- **Node:** v22.22.2

## Quick Commands

```bash
npm run dev              # Next.js dev (port 20128)
npm run build            # Production build
npm start                # Production server
docker build -t 9router .
docker run -p 20128:20128 9router
```

## Key Directories

| Path | Description |
|------|-------------|
| `src/` | Source code |
| `src/app/api/` | API routes (proxy, providers) |
| `docs/` | Documentation |
| `tests/` | Test files |

## Providers

- **Auth:** `9router` profile trong openclaw.json
- **Base URL:** `http://localhost:20128/v1`
- **Models:** openclaw-coder, openclaw-data, openclaw-free

## Database

- SQLite (better-sqlite3 primary, sql.js fallback)
- Runtime-generated — không commit

## Deployment

- Docker + CapRover
- Config: `captain-definition`, `diepxuan.config.mjs`

## Testing

- RTK compression: verify không mất context
- Fallback: provider fail → next provider
- Quota: tracking chính xác, auto-refresh đúng timing
- Multi-account: round-robin phân phối đều
