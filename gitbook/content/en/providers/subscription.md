# Subscription Providers

Maximize the value of your existing AI subscriptions through automatic token refresh and quota tracking.

---

## Supported Subscription Providers

| Provider | Prefix | Top Models | Notes |
|---|---|---|---|
| **Claude Code** | `cc/` | `cc/claude-opus-4-7`, `cc/claude-sonnet-4-6` | Anthropic Pro / Team / Max subscriptions |
| **OpenAI Codex** | `cx/` | `cx/gpt-5.5`, `cx/gpt-5.4`, `cx/gpt-5.3-codex` | ChatGPT Plus / Pro subscriptions |
| **GitHub Copilot** | `gh/` | `gh/gpt-5.4`, `gh/claude-opus-4.7` | GitHub Copilot Individual / Business |
| **Cursor** | `cu/` | `cu/claude-4.6-opus-max`, `cu/gpt-5.3-codex` | Cursor account integration |
| **Antigravity** | `ag/` | `ag/gemini-3-pro-high`, `ag/claude-sonnet-4-5` | Google account integration |

---

## Setup Steps

1. Start 9Router: `9router`
2. Open Dashboard at `http://localhost:20128` → **Providers**.
3. Click **Connect** on your provider (e.g. Claude Code or Codex).
4. Complete the OAuth login in your browser.
5. 9Router will automatically store and refresh your session tokens.

---

## Quota Tracking & Rolling Windows

9Router displays your real-time usage and window resets:

- **5-Hour Rolling Limit**: Visual indicator of immediate quota pressure.
- **Weekly / Monthly Reset Countdown**: Know exactly when full allocation returns.
- **Multi-Account Rotation**: Add multiple accounts per provider to automatically balance loads.

---

## Example Fallback Setup

Combine your subscription with a cheap backup:

```
Combo Name: primary-coding
Sequence:
  1. cc/claude-opus-4-7   (Subscription primary)
  2. glm/glm-5.1          (Cheap backup, ~$0.60/1M)
  3. kr/claude-sonnet-4.5 (Free emergency fallback)
```
