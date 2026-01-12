# Tech Stack

## Runtime & Framework
- **Runtime**: Node.js 20+ / Bun
- **Framework**: Next.js 15 (App Router)
- **React**: v19.2.1
- **Node Version**: 20+

## Frontend
- **UI Library**: React 19
- **CSS Framework**: Tailwind CSS 4 (configured in `postcss.config.mjs`)
- **State Management**: Zustand v5.0.9
- **Styling**: Tailwind utility classes

## Backend
- **Server**: Next.js API Routes (App Router pattern)
- **Streaming**: Server-Sent Events (SSE)
- **HTTP Client**: Undici v7.16.0 (high-performance)
- **Database**: LowDB v7.0.1 (JSON file-based)

## Authentication
- **OAuth**: OAuth 2.0 with PKCE flow
- **JWT**: Jose v6.1.3 for token handling
- **Password Hashing**: bcryptjs v3.0.3
- **API Keys**: UUID v13.0.0 for key generation

## Core Libraries
- **lowdb**: Lightweight JSON database for configuration storage
- **undici**: High-performance HTTP/1.1 client for upstream API calls
- **uuid**: Unique identifier generation for API keys
- **open**: Cross-platform browser launcher
- **ora**: Terminal spinners for CLI feedback
- **node-machine-id**: Machine identifier for licensing

## Development Tools
- **Linter**: ESLint v9 with Next.js config (`eslint-config-next`)
- **Build**: Next.js standalone output
- **Package Manager**: npm (standard)

## API & Protocols
- **REST**: Standard HTTP REST APIs
- **SSE**: Server-Sent Events for streaming responses
- **OAuth2**: PKCE flow for provider authentication
- **Proxy**: HTTP proxy middleware for request forwarding

## Configuration
- **Path Aliases**: `@/` → `src/` (configured in `jsconfig.json`)
- **URL Rewrites**: `/v1/*` → `/api/v1/*` (in `next.config.mjs`)
- **Build Mode**: Standalone (for deployment)
