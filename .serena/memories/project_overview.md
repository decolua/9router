# 9Router - Project Overview

## Purpose
**9Router** is an AI API proxy server that provides unified access to multiple AI providers (OpenAI, Claude, Gemini, GitHub Copilot, Qwen, DeepSeek, etc.) through a single endpoint with automatic format translation. Built as a JavaScript port of CLIProxyAPI with a Next.js-based web dashboard.

## Key Capabilities
- **Universal Proxy**: Single endpoint for 15+ AI providers
- **Format Translation**: Automatic conversion between OpenAI, Claude, Gemini, Codex, and Ollama formats
- **CLI Integration**: Works with Claude Code, Cursor, OpenAI Codex, Cline, RooCode, AmpCode
- **OAuth & API Keys**: Supports OAuth2 PKCE flow and API key authentication
- **Web Dashboard**: React-based UI for managing providers, combos, API keys, settings
- **Combo System**: Multi-model fallback chains with automatic retry
- **Intelligent Fallback**: Automatic account rotation on rate limits/errors
- **Usage Tracking**: Real-time monitoring and analytics

## Target Users
- Developers using AI coding assistants (Claude Code, Cursor, Codex)
- Teams needing unified access to multiple AI providers
- Users wanting automatic fallback between models

## Repository
- Issues: https://github.com/decolua/9router/issues
- Pull Requests: https://github.com/decolua/9router/pulls
- Website: https://9router.com

## Platform Support
- Cross-platform: Windows, Linux, macOS
- Node.js 20+ / Bun runtime
- Standalone deployment or VPS hosting

## Data Storage
User data persists in home directory (not in app bundle):
- macOS/Linux: `~/.9router/db.json`
- Windows: `%APPDATA%/9router/db.json`
