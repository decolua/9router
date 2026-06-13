# AI Router Proxy - Cloudflare Deployment Guide

Deploy AI Router Proxy globally on Cloudflare's edge network in minutes.

## 🚀 Quick Start: Cloudflare Pages

**Cloudflare Pages** is the easiest option for Next.js apps.

### Step 1: Connect GitHub to Cloudflare Pages

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Navigate to **Pages** → **Create a project**
3. Select **Connect to Git**
4. Authorize GitHub and select `ai-router-proxy` repository
5. Click **Begin setup**

### Step 2: Configure Build Settings

| Setting | Value |
|---------|-------|
| **Framework** | Next.js |
| **Build command** | `npm run build` |
| **Build output directory** | `.next` |
| **Node version** | 20 (recommended) |

### Step 3: Set Environment Variables

Add these in Cloudflare Pages > Settings > Environment variables:

```
NODE_ENV=production
NEXT_PUBLIC_BASE_URL=https://your-pages-domain.pages.dev
NEXT_PUBLIC_CLOUD_URL=https://your-pages-domain.pages.dev
PORT=3000
DATA_DIR=/tmp/.9router
JWT_SECRET=your-secure-secret-here
INITIAL_PASSWORD=change-me-now
```

### Step 4: Deploy

1. Click **Save and Deploy**
2. Cloudflare automatically builds and deploys on every push to `main`
3. Access at: `https://your-pages-domain.pages.dev`

---

## 🔧 Advanced: Cloudflare Workers

For more control and custom routing logic, use **Cloudflare Workers**.

### Prerequisites

```bash
npm install -g @cloudflare/wrangler
wrangler login
```

### Step 1: Configure wrangler.toml

Edit `wrangler.toml`:

```toml
account_id = "your-account-id"  # Get from wrangler whoami
workers_dev = true

[env.production]
route = "api.yourdomain.com/*"
zone_id = "your-zone-id"
```

### Step 2: Build and Deploy

```bash
# Local testing
wrangler dev

# Deploy to production
wrangler deploy --env production

# Deploy to staging
wrangler deploy --env staging
```

### Step 3: Verify Deployment

```bash
curl https://your-worker.workers.dev/v1/models
```

---

## 🗄️ Data Persistence: Cloudflare KV

Store provider configs and settings in KV for global access.

### Setup KV Storage

```bash
# Create namespaces
wrangler kv:namespace create "9router_data"
wrangler kv:namespace create "9router_data" --preview

# Add to wrangler.toml
kv_namespaces = [
  { binding = "DATA", id = "your-namespace-id", preview_id = "your-preview-id" }
]
```

### Use in Code

```javascript
// Store config
await env.DATA.put("config", JSON.stringify(config), { expirationTtl: 86400 });

// Retrieve config
const config = await env.DATA.get("config", "json");
```

---

## 📊 Custom Domain Setup

### Connect Custom Domain

1. **Cloudflare Pages:**
   - Pages > Your Project > Custom domain
   - Enter your domain and verify DNS records
   - Cloudflare auto-creates CNAME record

2. **Cloudflare Workers:**
   - Workers > Routes > Add route
   - Pattern: `api.yourdomain.com/*`
   - Service: `ai-router-proxy`
   - Zone: Select your zone

### DNS Configuration (if not using Cloudflare DNS)

Add CNAME record pointing to Cloudflare:

```
Name: api
Type: CNAME
Value: your-account.workers.dev (or Pages domain)
```

---

## 🔐 Security Configuration

### 1. Set Strong Secrets

```bash
# In Cloudflare Pages/Workers environment variables
JWT_SECRET=your-very-long-random-secret-here
API_KEY_SECRET=another-random-secret
MACHINE_ID_SALT=salt-for-hashing
```

### 2. Enable Authentication

```bash
REQUIRE_API_KEY=true  # Require Bearer token for /v1/* routes
AUTH_COOKIE_SECURE=true  # Force HTTPS cookies
```

### 3. Configure CORS

Add to Cloudflare Workers middleware:

```javascript
const corsHeaders = {
  "Access-Control-Allow-Origin": "https://yourdomain.com",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
```

---

## 🔄 CI/CD: Automatic Cloudflare Deployments

### GitHub Actions Workflow

Create `.github/workflows/cloudflare-deploy.yml`:

```yaml
name: Deploy to Cloudflare

on:
  push:
    branches: [main, staging]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: "20"
      
      - run: npm install
      - run: npm run build
      
      - name: Deploy to Cloudflare Pages
        uses: cloudflare/pages-action@v1
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          projectName: ai-router-proxy
          directory: .next
          gitHubToken: ${{ secrets.GITHUB_TOKEN }}
```

### Setup Secrets

In GitHub repo settings, add:
- `CLOUDFLARE_API_TOKEN` - Create at dash.cloudflare.com/profile/api-tokens
- `CLOUDFLARE_ACCOUNT_ID` - From `wrangler whoami`

---

## 📈 Performance Optimization

### Enable Caching

```bash
# Cache static assets for 1 year
Cache-Control: public, max-age=31536000, immutable

# Cache API responses for 5 minutes
Cache-Control: public, max-age=300
```

### Enable Compression

Cloudflare automatically:
- Compresses HTML, CSS, JS with Brotli
- Minifies CSS and JS
- Optimizes images

### Use Cloudflare Analytics

1. Enable in Cloudflare dashboard
2. View real-time metrics:
   - Requests per second
   - Cache hit ratio
   - Error rates
   - Response times

---

## 🧪 Testing Production Deployment

```bash
# Test health endpoint
curl https://your-domain.pages.dev/v1/models

# Test with auth
curl -H "Authorization: Bearer your-api-key" \
  https://your-domain.pages.dev/v1/chat/completions

# Monitor logs
wrangler tail  # Tail real-time logs
```

---

## ⚡ Performance Tips

1. **Use Argo Smart Routing** - Reduces latency by 30%
2. **Enable Mirage** - Loads images 50% faster
3. **Enable Polish** - Auto-optimizes images
4. **Use Early Hints** - Pre-loads critical resources
5. **Configure cache rules** - Optimize cache hit ratio

---

## 🆘 Troubleshooting

| Issue | Solution |
|-------|----------|
| **Build fails** | Check build logs in Cloudflare dashboard |
| **404 on routes** | Ensure `.next` is output directory, not `out` |
| **High latency** | Enable Argo Smart Routing, check cache rules |
| **KV errors** | Verify namespace binding in wrangler.toml |
| **Auth failing** | Check JWT_SECRET is same across deploys |

---

## 📚 Resources

- [Cloudflare Pages Docs](https://developers.cloudflare.com/pages/)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Cloudflare KV Docs](https://developers.cloudflare.com/workers/runtime-apis/kv/)
- [Next.js on Cloudflare](https://developers.cloudflare.com/pages/framework-guides/nextjs/)

---

## 🎯 Estimated Costs

| Tier | Include | Cost |
|------|---------|------|
| **Cloudflare Free** | 1 Pages project, unlimited requests | $0/month |
| **Cloudflare Pro** | Custom domain, 160 deploys/day | $20/month |
| **Cloudflare Business** | Priority support, Workers included | $200/month |

---

**Status:** ✅ Ready for Cloudflare deployment  
**Last updated:** 2026-06-12
