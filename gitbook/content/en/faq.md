# Frequently Asked Questions

Common questions about 9Router.

---

## What is 9Router?

**9Router is an AI model router that maximizes your subscription value and minimizes costs.**

It intelligently routes requests across multiple AI providers using a 3-tier fallback system:
1. **Subscription tier** - Maximize Claude Code, Codex, Gemini quotas you already pay for
2. **Cheap tier** - Ultra-cheap alternatives ($0.20-$0.60 per 1M tokens)
3. **Free tier** - Emergency backup with unlimited free models

**Key benefits:**
- Never waste subscription quota
- Automatic fallback when quota exhausted
- Real-time quota tracking
- 90% cost savings vs direct API usage

---

## How does pricing work?

**9Router uses a 3-tier pricing strategy:**

### Tier 1: Subscription (Maximize First)
- **Claude Code** (Pro/Max): $20-100/month - 5-hour + weekly quota
- **OpenAI Codex** (Plus/Pro): $20-200/month - 5-hour + weekly quota
- **Gemini CLI**: FREE - 180K completions/month + 1K/day
- **GitHub Copilot**: $10-19/month - Monthly reset
- **Antigravity**: FREE - Similar to Gemini

**Goal:** Use every bit of quota before it resets!

### Tier 2: Cheap (Backup)
- **GLM-4.7**: $0.60/$2.20 per 1M tokens - Daily reset 10AM
- **MiniMax M2.1**: $0.20/$1.00 per 1M tokens - 5-hour rolling
- **Kimi K2**: $9/month flat (10M tokens)

**Goal:** 90% cheaper than ChatGPT API ($20/1M)!

### Tier 3: Free (Emergency)
- **iFlow**: 8 models FREE (Kimi K2, Qwen3, GLM, MiniMax...)
- **Qwen**: 3 models FREE (Qwen3 Coder Plus/Flash, Vision)
- **Kiro**: 2 models FREE (Claude Sonnet 4.5, Haiku 4.5)

**Goal:** Zero cost fallback when everything else is quota-limited!

---

## Is 9Router free?

**Yes, 9Router itself is 100% free and open source.**

**Free tier providers available:**
- **Gemini CLI** - 180K completions/month (FREE Google account)
- **iFlow** - 8 models unlimited (FREE OAuth)
- **Qwen** - 3 models unlimited (FREE OAuth)
- **Kiro** - Claude Sonnet/Haiku (FREE AWS Builder ID)

**You can code for FREE forever using only free tier providers!**

**Optional paid providers:**
- Subscription services you may already have (Claude Code, Codex, Copilot)
- Ultra-cheap alternatives ($0.20-$0.60 per 1M tokens)

---

## Which providers are supported?

### Subscription Providers
- **Claude Code** (Pro/Max) - Claude 4.5 Opus/Sonnet/Haiku
- **OpenAI Codex** (Plus/Pro) - GPT 5.2 Codex, GPT 5.1 Codex Max
- **Gemini CLI** (FREE) - Gemini 3 Flash/Pro, 2.5 Pro/Flash
- **GitHub Copilot** - GPT-5, Claude 4.5, Gemini 3
- **Antigravity** (Google) - Gemini 3 Pro, Claude Sonnet 4.5

### Cheap Providers
- **GLM** (Zhipu AI) - GLM 4.7, GLM 4.6V Vision
- **MiniMax** - MiniMax M2.1
- **Kimi** (Moonshot AI) - Kimi Latest
- **OpenRouter** - Passthrough to any OpenRouter model

### Free Providers
- **iFlow** - 8 models (Kimi K2, Qwen3, GLM, MiniMax, DeepSeek...)
- **Qwen** - 3 models (Qwen3 Coder Plus/Flash, Vision)
- **Kiro** - 2 models (Claude Sonnet 4.5, Haiku 4.5)

**Total: 15+ providers, 50+ models**

See [providers documentation](providers/subscription.md) for details.

---

## Can I use multiple providers?

**Yes! This is 9Router's core feature.**

**Combos allow you to chain multiple providers with automatic fallback:**

```
Example combo: "premium-coding"
1. cc/claude-opus-4-5 (Subscription primary)
2. glm/glm-4.7 (Cheap backup)
3. if/kimi-k2 (Free emergency)

→ Auto-switches when quota exhausted
→ Never stops coding
→ Minimal extra cost
```

**How to create combos:**
```
Dashboard → Combos → Create New
→ Add models in priority order
→ Use combo name in CLI: "premium-coding"
```

**Benefits:**
- Zero downtime when quota runs out
- Automatic cost optimization
- Single model name for all tools

See [combos documentation](features/combos.md) for examples.

---

## How does quota tracking work?

**9Router tracks quota in real-time for all providers:**

**Features:**
- **Token consumption** - Input/output tokens per request
- **Reset countdown** - Time until quota refreshes
- **Usage stats** - Daily/weekly/monthly reports
- **Cost estimation** - Projected spending (paid tiers)
- **Quota alerts** - Notifications when quota low

**Quota types:**
- **5-hour rolling** - Claude Code, Codex, MiniMax
- **Daily reset** - Gemini CLI (1K/day), GLM (10AM)
- **Weekly reset** - Claude Code, Codex (additional quota)
- **Monthly reset** - Gemini CLI (180K), GitHub Copilot (1st)

**View quota:**
```
Dashboard → Providers → Quota Tracking
→ Real-time usage + reset countdown
```

See [quota tracking documentation](features/quota-tracking.md) for details.

---

## Does 9Router work with Cursor?

**Yes, but Cursor requires a cloud endpoint.**

**Problem:** Cursor IDE doesn't support localhost endpoints.

**Solution:** Use 9Router cloud deployment:

```
Cursor Settings → Models → Advanced:
  OpenAI API Base URL: https://9router.com/v1
  OpenAI API Key: [from dashboard]
  Model: cc/claude-opus-4-5-20251101
```

**Alternative:** Self-host on VPS with public domain:
```bash
# Deploy to VPS
git clone https://github.com/decolua/9router.git
cd 9router/app
npm install && npm run build
npm start

# Configure Nginx reverse proxy
# Point Cursor to: https://your-domain.com/v1
```

**Other CLI tools work with localhost:**
- Cline ✅
- Claude Desktop ✅
- Codex CLI ✅
- Continue ✅
- RooCode ✅

See [Cursor integration guide](integration/cursor.md) for details.

---

## Can I self-host 9Router?

**Yes! 9Router supports multiple deployment options:**

### Localhost (Default)
```bash
npm install -g 9router
9router
→ Dashboard: http://localhost:3000
→ API: http://localhost:20128/v1
```

### VPS/Cloud
```bash
git clone https://github.com/decolua/9router.git
cd 9router/app
npm install && npm run build

export JWT_SECRET="your-secure-secret"
export INITIAL_PASSWORD="your-password"
export NODE_ENV="production"

npm start
```

### Docker
```bash
docker build -t 9router .
docker run -d \
  -p 3000:3000 \
  -e JWT_SECRET="your-secret" \
  -v 9router-data:/app/data \
  9router
```

### Cloudflare Workers
```bash
cd 9router/app
npm run deploy:cloudflare
```

**Environment variables:**
- `JWT_SECRET` - **MUST change in production!**
- `DATA_DIR` - Database storage path (default: `~/.9router`)
- `INITIAL_PASSWORD` - Dashboard login (default: `123456`)
- `NODE_ENV` - Set to `production` for deploy

See [deployment guide](getting-started/installation.md#deployment) for details.

---

## Is my data secure?

**Yes, 9Router prioritizes security and privacy:**

**Local storage:**
- All data stored locally in `~/.9router` (or custom `DATA_DIR`)
- No data sent to 9Router servers
- OAuth tokens encrypted with JWT

**No telemetry:**
- No usage tracking
- No analytics
- No phone-home

**Open source:**
- Full source code available on GitHub
- Audit security yourself
- Community-reviewed

**Best practices:**
- Change `JWT_SECRET` in production
- Use strong `INITIAL_PASSWORD`
- Enable HTTPS for cloud deployments
- Rotate API keys regularly

**What 9Router stores:**
- Provider OAuth tokens (encrypted)
- API keys (encrypted)
- Usage statistics (local only)
- Combo configurations

**What 9Router does NOT store:**
- Your prompts or responses
- Code you generate
- Personal information

---

## How do I update 9Router?

**Update methods depend on installation type:**

### Global NPM Install
```bash
npm update -g 9router
```

### Local Install
```bash
cd 9router/app
git pull origin main
npm install
npm run build
npm start
```

### Docker
```bash
docker pull 9router:latest
docker stop 9router
docker rm 9router
docker run -d \
  -p 3000:3000 \
  -v 9router-data:/app/data \
  9router:latest
```

**Check version:**
```bash
9router --version
```

**Breaking changes:**
- Check [CHANGELOG.md](https://github.com/decolua/9router/blob/main/CHANGELOG.md)
- Backup `~/.9router` before major updates
- Review migration guides for major versions

---

## How can I contribute?

**We welcome contributions!**

### Ways to contribute:

1. **Report bugs:**
   - [GitHub Issues](https://github.com/decolua/9router/issues)
   - Include error logs, steps to reproduce

2. **Request features:**
   - [GitHub Discussions](https://github.com/decolua/9router/discussions)
   - Describe use case and benefits

3. **Submit code:**
   ```bash
   # Fork repo
   git clone https://github.com/YOUR_USERNAME/9router.git
   cd 9router
   
   # Create branch
   git checkout -b feature/your-feature
   
   # Make changes
   npm install
   npm run dev
   
   # Test
   npm test
   
   # Commit and push
   git add .
   git commit -m "Add your feature"
   git push origin feature/your-feature
   
   # Create Pull Request on GitHub
   ```

4. **Improve docs:**
   - Fix typos, add examples
   - Translate to other languages
   - Write tutorials

5. **Add providers:**
   - Implement new provider adapters
   - See `app/lib/providers/` for examples

**Contribution guidelines:**
- Follow existing code style
- Add tests for new features
- Update documentation
- Keep commits atomic and descriptive

See [CONTRIBUTING.md](https://github.com/decolua/9router/blob/main/CONTRIBUTING.md) for details.

---

## Need More Help?

- **Documentation:** [9router.com/docs](https://9router.com/docs)
- **GitHub:** [github.com/decolua/9router](https://github.com/decolua/9router)
- **Issues:** [github.com/decolua/9router/issues](https://github.com/decolua/9router/issues)
- **Troubleshooting:** [troubleshooting.md](troubleshooting.md)
