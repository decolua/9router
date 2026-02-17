# 9Router Cloud Worker

Deploy your own Cloudflare Worker to access 9Router from anywhere.

## Setup

```bash
# 1. Login to Cloudflare
bunx wrangler login

# 2. Install dependencies
cd ./cloud
bun install

# 3. Create KV & D1, then paste IDs into wrangler.toml
bunx wrangler kv namespace create KV
bunx wrangler d1 create proxy-db

# 4. Init database & deploy
bunx wrangler d1 execute proxy-db --remote --file=./migrations/0001_init.sql
bunx wrangler deploy
```

Copy your Worker URL → 9Router Dashboard → **Endpoint** → **Setup Cloud** → paste → **Save** → **Enable Cloud**.
