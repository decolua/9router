# 9ROUTER - AI Proxy

> Universal AI Proxy for Claude Code, Codex, Cursor | OpenAI, Claude, Gemini, Copilot

**Website: [9router.com](https://9router.com)**

[![npm version](https://img.shields.io/npm/v/9router.svg)](https://www.npmjs.com/package/9router)
[![Downloads](https://img.shields.io/npm/dm/9router.svg)](https://www.npmjs.com/package/9router)
[![License](https://img.shields.io/npm/l/9router.svg)](https://github.com/yourusername/9router/blob/main/LICENSE)

A JavaScript port of CLIProxyAPI with web dashboard.

![9Router Dashboard](./images/9router.png)

## Introduction

**9Router** is a powerful AI API proxy server that provides unified access to multiple AI providers through a single endpoint. It features automatic format translation, intelligent fallback routing, OAuth authentication, and a modern web dashboard for easy management.

**Key Highlights:**
- **JavaScript Port**: Converted from CLIProxyAPI (Go) to JavaScript/Node.js.
- **Universal CLI Support**: Works seamlessly with Claude Code, OpenAI Codex, Cline, RooCode, AmpCode, Kilo, and other CLI tools
- **Cross-Platform**: Runs on Windows, Linux, and macOS
- **Easy Deployment**: Simple installation via npx, or deploy to VPS/Dokploy

## Recent Updates

### v0.2.27
- **OpenAI Responses API Support**: Full support for Codex CLI streaming via the Responses API format
- **`/v1/models` Endpoint**: OpenAI-compatible models endpoint for client discovery
- **Combo Support in Models**: Model combos now appear in the `/v1/models` endpoint
- **Improved Usage Tracking**: Better handling of request status for streaming responses
- **Kiro (AWS CodeWhisperer) Support**: New provider integration

### Provider Support
| Provider | Alias | Auth Type | Format |
|----------|-------|-----------|--------|
| Claude (Anthropic) | `cc` | OAuth | Claude |
| Codex (OpenAI) | `cx` | OAuth | Responses API |
| Gemini CLI | `gc` | OAuth | Gemini CLI |
| Antigravity (Google) | `ag` | OAuth | Antigravity |
| GitHub Copilot | `gh` | OAuth | OpenAI |
| Qwen | `qw` | OAuth | OpenAI |
| iFlow | `if` | OAuth | OpenAI |
| Kiro (AWS) | `kr` | OAuth | Kiro |
| OpenAI | `openai` | API Key | OpenAI |
| Anthropic | `anthropic` | API Key | Claude |
| Gemini | `gemini` | API Key | Gemini |
| OpenRouter | `openrouter` | API Key | OpenAI |

## Features

### Core Features
- **Multi-Provider Support**: Unified endpoint for 15+ AI providers
- **OAuth & API Key Authentication**: Supports both OAuth2 flow and API key authentication
- **Format Translation**: Automatic request/response translation between OpenAI, Claude, Gemini, Codex, and Kiro formats
- **Web Dashboard**: React-based dashboard for managing providers, combos, API keys, and settings
- **Usage Tracking**: Real-time monitoring and analytics for all API requests

### Advanced Features
- **Combo System**: Create model combos with automatic fallback support
- **Intelligent Fallback**: Automatic account rotation when rate limits or errors occur
- **Response Caching**: Optimized caching for Claude Code
- **Model Aliases**: Create custom model aliases for easier management

### Format Support
- **OpenAI Format**: Standard OpenAI Chat Completions API
- **OpenAI Responses API**: Codex CLI format with streaming
- **Claude Format**: Anthropic Messages API
- **Gemini Format**: Google Generative AI API
- **Kiro Format**: AWS CodeWhisperer format

## Install

```bash
# Install globally
npm install -g 9router
9router

# Run directly with npx
npx 9router
```

## Quick Start

```bash
9router                    # Start server with default settings
9router --port 8080        # Custom port
9router --no-browser       # Don't open browser
9router --skip-update      # Skip auto-update check
9router --help             # Show help
```

**Dashboard**: `http://localhost:20128/dashboard`

## Remote Deployment

### Environment Variables

Configure these environment variables for remote deployment:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATA_DIR` | No | `~/.9router` | Custom data directory path for database storage |
| `JWT_SECRET` | **Yes** | `9router-default-secret-change-me` | Secret key for JWT authentication. **Change this in production!** |
| `INITIAL_PASSWORD` | No | `123456` | Initial dashboard login password |
| `API_KEY_SECRET` | No | Auto-generated | Secret for API key generation/validation |
| `MACHINE_ID_SALT` | No | Auto-generated | Salt for machine ID hashing |
| `NEXT_PUBLIC_BASE_URL` | No | `http://localhost:3000` | Public base URL of your deployment |
| `NEXT_PUBLIC_CLOUD_URL` | No | `https://9router.com` | Cloud sync URL (for cloud features) |
| `ENABLE_REQUEST_LOGS` | No | `false` | Enable detailed request/response logging to files |
| `NODE_ENV` | No | `development` | Set to `production` for production deployments |

### Deploying to Dokploy

1. **Create a new application** in Dokploy
2. **Connect your Git repository** or use Docker
3. **Set environment variables** in Dokploy's settings:

```env
JWT_SECRET=your-secure-random-secret-here
INITIAL_PASSWORD=your-secure-password
DATA_DIR=/app/data
NODE_ENV=production
```

4. **Build command**: `npm run build`
5. **Start command**: `npm run start`
6. **Port**: `3000` (or configure via `PORT` env var)

### Deploying to VPS (Manual)

```bash
# Clone the repository
git clone https://github.com/yourusername/9router.git
cd 9router

# Install dependencies
npm install

# Set environment variables
export JWT_SECRET="your-secure-random-secret"
export INITIAL_PASSWORD="your-secure-password"
export DATA_DIR="/var/lib/9router"
export NODE_ENV="production"

# Build the application
npm run build

# Start the server
npm run start
```

### Using Docker

Create a `Dockerfile`:

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV DATA_DIR=/app/data

EXPOSE 3000

CMD ["npm", "run", "start"]
```

Build and run:

```bash
docker build -t 9router .
docker run -d \
  -p 3000:3000 \
  -e JWT_SECRET="your-secure-secret" \
  -e INITIAL_PASSWORD="your-password" \
  -v 9router-data:/app/data \
  9router
```

### Using with Reverse Proxy (Nginx)

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # SSE support
        proxy_buffering off;
        proxy_read_timeout 86400;
    }
}
```

## API Endpoints

### Chat Completions
```
POST /v1/chat/completions
```
OpenAI-compatible chat completions endpoint. Supports all providers with automatic format translation.

### Models List
```
GET /v1/models
```
Returns available models in OpenAI-compatible format, including combos.

### Responses API (Codex)
```
POST /v1/responses
POST /codex/responses
```
OpenAI Responses API endpoint for Codex CLI compatibility.

## CLI Integration Examples

### Claude Code
```bash
# Set your 9router endpoint
export ANTHROPIC_BASE_URL="http://your-server:3000/v1"

# Use with Claude Code
claude
```

### Codex CLI
```bash
# Configure Codex to use 9router
export OPENAI_BASE_URL="http://your-server:3000"

# Use Codex
codex
```

### Cursor IDE
Configure in Cursor settings:
- API Base URL: `http://your-server:3000/v1`
- Use your generated API key from the dashboard

## Debugging

### Enable Request Logging

Set the environment variable to capture full request/response data:

```bash
ENABLE_REQUEST_LOGS=true npm run start
```

Logs are saved to the `logs/` directory with the format:
```
logs/
└── {sourceFormat}_{targetFormat}_{model}_{timestamp}/
    ├── 1_client_raw_request.json
    ├── 2_raw_request.json
    ├── 3_converted_request.json
    ├── 4_provider_response.txt
    ├── 5_converted_response.txt
    └── 6_error.json (if error occurred)
```

### Console Debug Logging

The application includes debug logging for troubleshooting provider issues. Check your container/server logs for `[DEBUG]` prefixed messages.

## Data Location

User data stored at:
- **macOS/Linux**: `~/.9router/db.json`
- **Windows**: `%APPDATA%/9router/db.json`
- **Custom**: Set `DATA_DIR` environment variable

## Development

### Setup
```bash
# Clone repository
git clone https://github.com/yourusername/9router.git
cd 9router

# Install dependencies
npm install

# Start development server
npm run dev
```

### Project Structure
```
9router/
├── src/
│   ├── app/               # Next.js app (dashboard & API routes)
│   ├── lib/               # Core libraries (DB, OAuth, etc.)
│   ├── shared/            # Shared components & utilities
│   └── sse/               # SSE streaming handlers
├── open-sse/              # Core proxy engine (translator, handlers)
│   ├── translator/        # Format translators (request/response)
│   │   ├── request/       # Request translators
│   │   └── response/      # Response translators
│   ├── handlers/          # Request handlers
│   ├── executors/         # Provider-specific executors
│   ├── services/          # Core services (fallback, token refresh)
│   └── config/            # Provider configurations
├── tester/                # Testing utilities
└── public/                # Static assets
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Runtime** | Node.js 20+ / Bun |
| **Framework** | Next.js 15 |
| **Dashboard** | React 19 + Tailwind CSS 4 |
| **Database** | LowDB (JSON file-based) |
| **CLI** | Node.js CLI with auto-update |
| **Streaming** | Server-Sent Events (SSE) |
| **Auth** | OAuth 2.0 (PKCE) + API Keys |
| **Deployment** | Standalone / VPS / Docker |
| **State Management** | Zustand |

### Core Libraries
- **lowdb**: Lightweight JSON database
- **undici**: High-performance HTTP client
- **uuid**: Unique identifier generation
- **jose**: JWT handling
- **bcryptjs**: Password hashing

## Troubleshooting

### "The language model did not provide any assistant messages"

This error typically means the upstream provider returned an empty or malformed response. Check:
1. Your provider credentials are valid and not rate-limited
2. The model name is correct (e.g., `ag/gemini-3-pro-high`)
3. Enable debug logging to see the actual provider response

### OAuth Token Expired

OAuth tokens are automatically refreshed. If you see authentication errors:
1. Re-authenticate via the dashboard
2. Check if the provider's OAuth credentials are still valid

### Rate Limiting

9Router implements automatic fallback when rate limits are hit:
1. Add multiple accounts for the same provider
2. Configure account priorities in the dashboard
3. Use combos to fallback between different providers

## Acknowledgments

Special thanks to:

- **CLIProxyAPI**: The original Go implementation that inspired this project. 9Router is a JavaScript port with additional features and web dashboard.

## License

MIT License - see [LICENSE](LICENSE) for details.
