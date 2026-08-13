# Installation

Detailed installation guide for 10router with troubleshooting tips.

---

## Requirements

### System Requirements

- **Node.js**: Version 20.0.0 or higher
- **npm**: Version 10.0.0 or higher (comes with Node.js)
- **OS**: macOS, Linux, Windows (WSL recommended)
- **Disk Space**: ~200MB for installation

### Check Your Version

```bash
node --version
# Should show v20.x.x or higher

npm --version
# Should show 10.x.x or higher
```

**Don't have Node.js?** Install from [nodejs.org](https://nodejs.org/)

---

## Installation Methods

### Method 1: Global Installation (Recommended)

Install 10router globally to use from anywhere:

```bash
npm install -g 10router
```

**Start 10router:**

```bash
10router
```

**Benefits:**
- ✅ Run from any directory
- ✅ Simple command: `10router`
- ✅ Auto-updates with `npm update -g 10router`

### Method 2: Local Installation

Install in a specific project:

```bash
mkdir my-10router
cd my-10router
npm install 10router
```

**Start 10router:**

```bash
npx 10router
```

**Benefits:**
- ✅ Isolated per project
- ✅ Version control per project
- ✅ No global namespace pollution

### Method 3: From Source (Development)

Clone and build from GitHub:

```bash
git clone https://github.com/some-du6e/10router.git
cd 10router/app
npm install
npm run build
npm start
```

**Benefits:**
- ✅ Latest development features
- ✅ Contribute to development
- ✅ Custom modifications

---

## First Run

### Start the Server

```bash
10router
```

**What happens:**
1. Server starts on `http://localhost:20128`
2. Dashboard opens automatically in browser
3. Data directory created at `~/.9router`
4. API key generated automatically

### Dashboard Login

**There is no default password.** On first run 10router prints a one-time setup token to the server console:

```
  10router setup required (first run)
  Open the dashboard at /setup and paste this token:

      iMy2dXkv2J3pQrVHxcjBsce05izk0ACp

  Valid for 5 minutes. Restart the server to get a new one.
```

1. Open `http://localhost:20128/setup`
2. Paste the token and choose a password (at least 8 characters)

The token expires 5 minutes after startup — restart 10router to get a new one. Forgot the password later? Run the `10router` CLI on the host → **Settings** → **Reset Password**, which prints a fresh token.

### Get Your API Key

```
Dashboard → Settings → API Keys
→ Copy your API key
→ Use in CLI tools
```

**Example API key format:**
```
9r_1234567890abcdef1234567890abcdef
```

---

## Verify Installation

### Check Server Status

```bash
curl http://localhost:20128/health
```

**Expected response:**
```json
{
  "status": "ok",
  "version": "1.0.0"
}
```

### List Available Models

```bash
curl http://localhost:20128/v1/models \
  -H "Authorization: Bearer your-api-key"
```

**Expected response:**
```json
{
  "object": "list",
  "data": [
    {
      "id": "cc/claude-opus-4-5-20251101",
      "object": "model",
      "created": 1234567890,
      "owned_by": "claude-code"
    }
  ]
}
```

### Test Chat Completion

```bash
curl http://localhost:20128/v1/chat/completions \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "cc/claude-opus-4-5-20251101",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

---

## Configuration

### Environment Variables

Create `.env` file or set environment variables:

```bash
# Security (REQUIRED in production)
export JWT_SECRET="your-secure-secret-change-this"
export INITIAL_PASSWORD="your-password"

# Storage
export DATA_DIR="~/.9router"

# Server
export PORT="20128"
export NODE_ENV="production"

# Logging
export ENABLE_REQUEST_LOGS="false"
```

### Data Directory

**Default location:** `~/.9router` (the directory name is unchanged from the previous release for backward compatibility)

**Contents:**
```
~/.9router/
  ├── db.json           # Database (providers, combos, usage)
  ├── api-keys.json     # API keys
  └── logs/             # Request logs (if enabled)
```

**Change location:**

```bash
export DATA_DIR="/custom/path"
10router
```

### Port Configuration

**Default port:** `20128`

**Change port:**

```bash
export PORT="3000"
10router
```

**Or use command line:**

```bash
10router --port 3000
```

---

## Troubleshooting

### Port Already in Use

**Error:**
```
Error: listen EADDRINUSE: address already in use :::20128
```

**Solution 1: Kill existing process**

```bash
# Find process using port 20128
lsof -i :20128

# Kill process
kill -9 <PID>
```

**Solution 2: Use different port**

```bash
10router --port 3000
```

### Permission Denied

**Error:**
```
Error: EACCES: permission denied, mkdir '/usr/local/lib/node_modules/10router'
```

**Solution: Use sudo (not recommended) or fix npm permissions**

```bash
# Fix npm permissions (recommended)
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc

# Then install again
npm install -g 10router
```

### Node.js Version Too Old

**Error:**
```
Error: The engine "node" is incompatible with this module
```

**Solution: Update Node.js**

```bash
# Using nvm (recommended)
nvm install 20
nvm use 20

# Or download from nodejs.org
```

### Dashboard Not Opening

**Issue:** Dashboard doesn't open automatically

**Solution 1: Open manually**

```
http://localhost:20128
```

**Solution 2: Check firewall**

```bash
# macOS: Allow Node.js in System Preferences → Security
# Linux: Check iptables
# Windows: Check Windows Firewall
```

### Cannot Connect to Providers

**Issue:** OAuth login fails or API key invalid

**Solution 1: Check internet connection**

```bash
ping google.com
```

**Solution 2: Check provider status**

- Claude Code: [status.anthropic.com](https://status.anthropic.com)
- OpenAI: [status.openai.com](https://status.openai.com)
- Gemini: [status.cloud.google.com](https://status.cloud.google.com)

**Solution 3: Regenerate API key**

```
Dashboard → Provider → Disconnect → Reconnect
```

### High Memory Usage

**Issue:** 10router using too much RAM

**Solution: Restart server**

```bash
# Stop
pkill -f 10router

# Start
10router
```

**Or use PM2 for auto-restart:**

```bash
npm install -g pm2
pm2 start 10router --name 10router
pm2 save
```

---

## Deployment Options

### Local Development

```bash
npm install -g 10router
10router
```

**Use case:** Personal coding, testing

### VPS/Cloud Server

```bash
# Install
npm install -g 10router

# Configure
export JWT_SECRET="your-secure-secret"
export INITIAL_PASSWORD="your-password"
export NODE_ENV="production"

# Start with PM2
npm install -g pm2
pm2 start 10router --name 10router
pm2 save
pm2 startup
```

**Use case:** Team access, remote coding

### Docker

```bash
docker pull 10router/10router:latest

docker run -d \
  -p 20128:20128 \
  -e JWT_SECRET="your-secure-secret" \
  -e INITIAL_PASSWORD="your-password" \
  -v 10router-data:/root/.9router \
  --name 10router \
  10router/10router:latest
```

**Use case:** Containerized deployment, Kubernetes

### Reverse Proxy (Nginx)

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:20128;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        
        # SSE support for streaming
        proxy_buffering off;
        proxy_read_timeout 86400;
    }
}
```

**Use case:** HTTPS, custom domain, load balancing

---

## Uninstallation

### Remove Global Installation

```bash
npm uninstall -g 10router
```

### Remove Data Directory

```bash
rm -rf ~/.9router
```

### Remove Configuration

```bash
# Remove environment variables from shell config
nano ~/.bashrc  # or ~/.zshrc
# Delete 10router-related exports
```

---

## Next Steps

- [Getting Started Guide](../getting-started.md) - Connect providers and start coding
- [Features](../features/) - Explore quota tracking, combos, deployment
- [Troubleshooting](../troubleshooting.md) - Fix common issues

---

## Need Help?

- **GitHub**: [github.com/some-du6e/10router](https://github.com/some-du6e/10router)
- **Issues**: [github.com/some-du6e/10router/issues](https://github.com/some-du6e/10router/issues)
