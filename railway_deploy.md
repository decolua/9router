# 9router Railway Deployment + Stable Subdomain Setup

This guide covers deploying 9router to Railway (free trial) and setting up a
**stable subdomain** (`9router.eemaill.codes`) that survives Railway account
changes. When the 30-day trial expires, you switch accounts, redeploy, and run
ONE command — the public URL never changes.

---

## Architecture

```
Clients (Hermes, apps)
      |
      v
9router.eemaill.codes  ← STABLE (never changes)
      |  (Cloudflare Worker reverse proxy)
      v
KV: "9router" = https://xxx.up.railway.app  ← changes when you switch accounts
      |
      v
Railway app (9router)
```

The Worker reads the Railway URL from Cloudflare KV on every request. When you
switch Railway accounts, you update the KV value — no DNS change, no redeploy,
no client config change.

---

## Part 1: Deploy 9router to Railway

### 1.1 Create Railway account (or use new trial)
1. Go to https://railway.app
2. Sign up (GitHub login). New account = 30-day free trial.

### 1.2 Deploy from GitHub
1. Fork https://github.com/sirwhy/9router to your account.
2. In Railway dashboard: **New Project → Deploy from GitHub repo**.
3. Select your fork of `9router`.
4. Railway auto-detects the Node.js app and builds.
5. Wait for build to complete (watch the Deployments tab).

### 1.3 Set environment variables
In Railway: **Variables** tab, add:
```
ADMIN_PASSWORD=BEJIRWAE
# (any other vars your 9router fork needs)
```

### 1.4 Generate a public URL
1. **Settings → Networking → Generate Domain**.
2. Railway assigns: `https://<random-name>.up.railway.app`
3. Test: `curl https://<random-name>.up.railway.app/api/health` → `{"ok":true}`

### 1.5 (Optional) Set a custom Railway subdomain
Instead of the random URL, you can set a custom subdomain within Railway's domain:
1. **Settings → Networking → Generate Domain** (if not done).
2. Click the generated domain → **Edit** → type a custom name like `9router`.
3. URL becomes: `https://9router.up.railway.app` (if available).
4. This Railway subdomain changes per account but is cleaner to read.

---

## Part 2: Set up the stable subdomain (9router.eemaill.codes)

This is a ONE-TIME setup. After this, you never touch DNS or the Worker again.

### 2.1 Prerequisites
- Cloudflare account with `eemaill.codes` zone active.
- Credentials at `~/.agent/credentials/cloudflare-eemaill.env`.
- Wrangler CLI: `npm install -g wrangler`.

### 2.2 Create KV namespace (one-time)
```bash
source ~/.agent/credentials/cloudflare-eemaill.env
export CLOUDFLARE_EMAIL="$CF_GLOBAL_API_EMAIL"
export CLOUDFLARE_API_KEY="$CF_GLOBAL_API_KEY"

wrangler kv namespace create RAILWAY_TARGETS
# Note the ID from the output. It's already in wrangler.toml:
# id = "84200158bb704865bbf4eba01867fe54"
```

### 2.3 Store the Railway URL in KV (one-time, or when switching accounts)
```bash
KV_ID="84200158bb704865bbf4eba01867fe54"
curl -X PUT \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/storage/kv/namespaces/$KV_ID/values/9router" \
  -H "X-Auth-Email: $CF_GLOBAL_API_EMAIL" \
  -H "X-Auth-Key: $CF_GLOBAL_API_KEY" \
  -H "Content-Type: text/plain" \
  --data "https://9router-production-bf71.up.railway.app"
```

### 2.4 Deploy the Worker (one-time)
```bash
cd /root/scripts/9router-proxy
wrangler deploy
```
Output: `https://9router-proxy.kania-cloudmail.workers.dev`

### 2.5 Set the ADMIN_KEY secret (one-time)
```bash
echo "kania-9router-admin-2026" | wrangler secret put ADMIN_KEY
```

### 2.6 Create DNS + Worker route (one-time)
```bash
source ~/.agent/credentials/cloudflare-eemaill.env
ZONE_ID="$CF_ZONE_ID"
ACCOUNT_ID="$CF_ACCOUNT_ID"

# DNS: CNAME 9router.eemaill.codes -> workers.dev (proxied)
curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
  -H "X-Auth-Email: $CF_GLOBAL_API_EMAIL" \
  -H "X-Auth-Key: $CF_GLOBAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type":"CNAME","name":"9router","content":"9router-proxy.kania-cloudmail.workers.dev","proxied":true}'

# Worker route: 9router.eemaill.codes/* -> 9router-proxy script
curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/workers/routes" \
  -H "X-Auth-Email: $CF_GLOBAL_API_EMAIL" \
  -H "X-Auth-Key: $CF_GLOBAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"pattern":"9router.eemaill.codes/*","script":"9router-proxy"}'
```

### 2.7 Verify
```bash
curl https://9router.eemaill.codes/api/health
# → {"ok":true}

curl https://9router.eemaill.codes/__target -H "X-Admin-Key: kania-9router-admin-2026"
# → {"target":"https://9router-production-bf71.up.railway.app"}
```

---

## Part 3: Switching Railway accounts (when trial expires)

When the 30-day trial runs out, do this:

### 3.1 Create new Railway account + redeploy
1. Sign up a new Railway account (new GitHub account or new email).
2. Fork `sirwhy/9router` (or reuse existing fork).
3. Deploy from GitHub (same as Part 1).
4. Generate a new public URL: `https://<new-random>.up.railway.app`.

### 3.2 Update the stable subdomain (ONE command)
```bash
/root/scripts/9router-proxy/update-target.sh https://<new-random>.up.railway.app
```

That's it. `9router.eemaill.codes` now points to the new Railway app.
- No DNS change.
- No Worker redeploy.
- No Hermes config change.
- No client config change.

### 3.3 Verify after switch
```bash
curl https://9router.eemaill.codes/api/health
# → {"ok":true}
```

---

## Part 4: Hermes configuration (uses stable URL)

In `~/.hermes/profiles/agentrouter/config.yaml`:
```yaml
model:
  provider: custom
  model: agentrouter/claude-opus-4-8
  base_url: https://9router.eemaill.codes/v1
  api_key: sk-c211441501d0f8da-fauv84-4f465ab2
```

This URL **never changes**. Even after switching Railway accounts, Hermes keeps
working because the Worker proxies to whatever Railway URL is in KV.

---

## Part 5: Admin endpoint

Check or update the Railway target programmatically:

```bash
# Check current target
curl https://9router.eemaill.codes/__target \
  -H "X-Admin-Key: kania-9router-admin-2026"

# Update target (alternative to the shell script)
curl -X POST https://9router.eemaill.codes/__target \
  -H "X-Admin-Key: kania-9router-admin-2026" \
  -H "Content-Type: application/json" \
  -d '{"target":"https://new-app.up.railway.app"}'
```

---

## Files

| File | Purpose |
|------|---------|
| `/root/scripts/9router-proxy/worker.js` | Cloudflare Worker reverse proxy |
| `/root/scripts/9router-proxy/wrangler.toml` | Worker config (KV binding, route) |
| `/root/scripts/9router-proxy/update-target.sh` | One-command Railway URL switcher |

## Credentials
- CF account: `dwianggaerlangga@gmail.com` (eemaill.codes zone)
- KV namespace ID: `84200158bb704865bbf4eba01867fe54`
- Worker name: `9router-proxy`
- Admin key: `kania-9router-admin-2026`
- Stable URL: `https://9router.eemaill.codes`
