# Cloudflare Worker for 9Router Tunnel Registration

This directory contains a Cloudflare Worker that provides stable public URLs for 9Router tunnel endpoints.

## Quick Start

### Prerequisites

- Cloudflare account (free tier works)
- Node.js and npm installed
- Domain managed by Cloudflare (optional, for custom domain)

### Setup

1. **Install Wrangler CLI**
   ```bash
   npm install -g wrangler
   ```

2. **Login to Cloudflare**
   ```bash
   wrangler login
   ```

3. **Run Setup Script**
   ```bash
   chmod +x setup.sh
   ./setup.sh
   ```

   This will:
   - Create a KV namespace for tunnel mappings
   - Generate `wrangler.toml` with your KV namespace ID
   - Deploy the worker to Cloudflare

4. **Configure Your Domain**
   
   Edit `wrangler.toml` and change:
   ```toml
   [vars]
   PUBLIC_DOMAIN = "yourdomain.com"
   ```

5. **Deploy**
   ```bash
   wrangler deploy
   ```

## Files

- **`tunnel-register.js`** - Worker code handling tunnel registration and lookup
- **`wrangler.toml`** - Worker configuration (template, will be overwritten by setup.sh)
- **`setup.sh`** - Automated setup script

## Worker Endpoints

- `POST /api/tunnel/register` - Register a new tunnel
- `GET /api/tunnel/:shortId` - Get tunnel information
- `GET /api/tunnel/:shortId/redirect` - Redirect to tunnel URL
- `GET /api/tunnel/list` - List all active tunnels
- `GET /api/health` - Health check

## Usage with 9Router

After deploying the worker, configure your 9Router instance:

```bash
docker run -d \
  --name 9router \
  -p 20128:20128 \
  -e PUBLIC_DOMAIN=yourdomain.com \
  -e TUNNEL_WORKER_URL=https://9router-tunnel-registration.your-subdomain.workers.dev \
  -v 9router-data:/app/data \
  9router
```

Or use `.env`:
```env
PUBLIC_DOMAIN=yourdomain.com
TUNNEL_WORKER_URL=https://9router-tunnel-registration.your-subdomain.workers.dev
```

## Documentation

See [CUSTOM_DOMAIN_TUNNEL.md](../docs/CUSTOM_DOMAIN_TUNNEL.md) for complete setup instructions.

## Troubleshooting

### Worker not deploying

Check wrangler logs:
```bash
wrangler tail
```

### KV namespace issues

List your KV namespaces:
```bash
wrangler kv:namespace list
```

### Update worker

```bash
wrangler deploy
```

