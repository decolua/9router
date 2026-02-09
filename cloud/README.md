# 9Router Cloud Worker

Deploy your own Cloudflare Worker to access 9Router from anywhere.

## Setup

```bash
# 1. Login to Cloudflare
npm install -g wrangler
wrangler login

# 2. Install dependencies
cd app/cloud
npm install

# 3. Create KV & D1, then paste IDs into wrangler.toml
wrangler kv namespace create KV
wrangler d1 create proxy-db

# 4. Init database & deploy
wrangler d1 execute proxy-db --remote --file=./migrations/0001_init.sql
npm run deploy
```

Copy your Worker URL → 9Router Dashboard → **Endpoint** → **Setup Cloud** → paste → **Save** → **Enable Cloud**.
