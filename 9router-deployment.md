---
name: 9router-deployment
description: "How 9Router is deployed, configured, and accessed via demo.ssoni.top"
metadata: 
  node_type: memory
  type: project
  originSessionId: b5619d14-4188-411a-972c-93cbf65ac670
---

# 9Router Deployment

## Access
- **URL**: `https://demo.ssoni.top/9router/v1`
- **API Key**: `sk-e76d011c741fe253-ih2zrq-c44f3878` (Bearer token in Authorization header)
- **Base path**: `/9router` (set via `NINEROUTER_BASE_PATH` env var at build time)

## Server
- **Machine**: `173.249.220.203` (same as demo.ssoni.top, no Docker)
- **Port**: `20128` (Next.js standalone, bound to 0.0.0.0)
- **nginx**: Port 443 → proxies to `127.0.0.1:20128`, strips `/9router` prefix
- **Start command**: `node custom-server.js` with env vars
- **Source**: `/home/ram/Projects/9router/`
- **Deploy directory**: `/home/ram/Projects/9router-deploy/`
- **Data directory**: `/home/ram/.9router/` (SQLite DB at `db/data.sqlite`)

## Required Env Vars
- `API_KEY_SECRET=sk-e76d011c741fe253-ih2zrq-c44f3878`
- `INITIAL_PASSWORD=123456`
- `PORT=20128`
- `NINEROUTER_BASE_PATH=/9router`
- `NODE_ENV=production`
- `DATA_DIR=/home/ram/.9router`

## Deploy Steps
```bash
cd /home/ram/Projects/9router
NINEROUTER_BASE_PATH=/9router npm run build
fuser -k 20128/tcp
# Copy .next/standalone/* to /home/ram/Projects/9router-deploy/
# Also copy: custom-server.js, open-sse/, src/mitm/, src/lib/upstreamModelMetadata.js
cd /home/ram/Projects/9router-deploy
API_KEY_SECRET=... INITIAL_PASSWORD=... PORT=20128 NINEROUTER_BASE_PATH=/9router NODE_ENV=production DATA_DIR=/home/ram/.9router node custom-server.js &
```

## Code Changes Made
- `src/app/api/v1/models/info/route.js` — model info endpoint with upstream metadata + synthetic entries
- `src/app/api/v1/models/route.js` — only shows configured providers (dbUnavailable flag), caches upstream metadata
- `src/lib/upstreamModelMetadata.js` — fetches/parses/caches upstream model capabilities from provider /models endpoints

## API Key (for endpoint access)
Stored in DB `apiKeys` table (not `API_KEY_SECRET` env var). Insert with:
```python
db.execute("INSERT OR IGNORE INTO apiKeys (key, name, isActive, createdAt) VALUES ('sk-e76d011c741fe253-ih2zrq-c44f3878', 'default', 1, datetime('now'))")
```

## Connections
- `syn` provider: `openai-compatible-chat-e6a56b6f-...` → `https://api.synthetic.new/openai/v1`
- Connection has `apiKey` and `providerSpecificData.baseUrl/prefix` fields (flattened from data JSON via `rowToConn`)
