# Bắt đầu

Khởi chạy 9Router trong 5 phút và bắt đầu định tuyến các request AI một cách thông minh.

---

## Bắt đầu nhanh

### 1. Cài đặt

```bash
npm install -g 9router
```

**Yêu cầu:** Node.js 20+ ([Chi tiết cài đặt](getting-started/installation.md))

### 2. Khởi chạy

```bash
9router
```

🎉 **Dashboard tự động mở** tại `http://localhost:20128`

- Mật khẩu mặc định: `123456` (đổi trong dashboard)
- API key được tạo tự động
- Sẵn sàng kết nối provider

### 3. Kết nối Provider

Bạn có 3 cách để kết nối provider:

#### Cách A: OAuth (Subscription Provider)

**Tốt nhất cho:** Claude Code, Codex, Gemini CLI, GitHub Copilot

```
Dashboard → Providers → Connect [Provider]
→ OAuth login → Auto token refresh
→ Quota tracking enabled
```

**Ví dụ: Claude Code**
1. Click "Connect Claude Code"
2. Đăng nhập tài khoản Claude
3. Cho phép 9Router
4. ✅ Xong! Dùng model: `cc/claude-opus-4-5-20251101`

#### Cách B: API Key (Cheap Provider)

**Tốt nhất cho:** GLM, MiniMax, Kimi, OpenRouter

```
Dashboard → Providers → Add API Key
→ Select provider
→ Paste API key
→ Save
```

**Ví dụ: GLM-4.7**
1. Đăng ký tại [Zhipu AI](https://open.bigmodel.cn/)
2. Lấy API key từ Coding Plan
3. Dashboard → Add API Key → Provider: `glm` → Paste key
4. ✅ Xong! Dùng model: `glm/glm-4.7`

#### Cách C: Free Provider (Miễn phí)

**Tốt nhất cho:** iFlow, Qwen, Kiro

```
Dashboard → Providers → Connect [Free Provider]
→ Device code or OAuth
→ Unlimited usage
```

**Ví dụ: iFlow**
1. Click "Connect iFlow"
2. Đăng nhập tài khoản iFlow
3. Cho phép
4. ✅ Xong! Dùng 8 model: `if/kimi-k2-thinking`, `if/qwen3-coder-plus`, v.v.

---

## 4. Dùng trong CLI Tools

Trỏ công cụ code của bạn tới 9Router:

### Cursor IDE

```
Settings → Models → Advanced:
  OpenAI API Base URL: http://localhost:20128/v1
  OpenAI API Key: [from 9router dashboard]
  Model: cc/claude-opus-4-5-20251101
```

### Claude Desktop

Sửa `~/.claude/config.json`:

```json
{
  "anthropic_api_base": "http://localhost:20128/v1",
  "anthropic_api_key": "your-9router-api-key"
}
```

### Cline / Continue / RooCode

```
Provider: OpenAI Compatible
Base URL: http://localhost:20128/v1
API Key: [from dashboard]
Model: cc/claude-opus-4-5-20251101
```

### Codex CLI

```bash
export OPENAI_BASE_URL="http://localhost:20128"
export OPENAI_API_KEY="your-9router-api-key"

codex "your prompt"
```

---

## 5. Tạo Smart Combos (Tùy chọn)

Combo cho phép fallback tự động giữa các model:

```
Dashboard → Combos → Create New

Name: premium-coding
Models:
  1. cc/claude-opus-4-5-20251101 (Subscription primary)
  2. glm/glm-4.7 (Cheap backup, $0.6/1M)
  3. if/kimi-k2-thinking (Free fallback)

Use in CLI: premium-coding
```

**Cách hoạt động:**
1. Thử Claude Opus trước (subscription của bạn)
2. Nếu hết quota → GLM-4.7 (siêu rẻ)
3. Nếu hết budget → iFlow (miễn phí)
4. Zero downtime, chuyển đổi tự động!

---

## Model có sẵn

### Subscription Models (Dùng đầu tiên)

**Claude Code (`cc/`)** - Subscription Pro/Max:
- `cc/claude-opus-4-5-20251101` - Claude 4.5 Opus
- `cc/claude-sonnet-4-5-20250929` - Claude 4.5 Sonnet
- `cc/claude-haiku-4-5-20251001` - Claude 4.5 Haiku

**Codex (`cx/`)** - Subscription Plus/Pro:
- `cx/gpt-5.2-codex` - GPT 5.2 Codex
- `cx/gpt-5.1-codex-max` - GPT 5.1 Codex Max

**Gemini CLI (`gc/`)** - MIỄN PHÍ 180K/tháng:
- `gc/gemini-3-flash-preview` - Gemini 3 Flash Preview
- `gc/gemini-2.5-pro` - Gemini 2.5 Pro

**GitHub Copilot (`gh/`)** - Subscription:
- `gh/gpt-5` - GPT-5
- `gh/claude-4.5-sonnet` - Claude 4.5 Sonnet

### Cheap Models (Backup)

**GLM (`glm/`)** - $0.6/$2.2 per 1M:
- `glm/glm-4.7` - GLM 4.7 (reset 10AM hàng ngày)

**MiniMax (`minimax/`)** - $0.20/$1.00 per 1M:
- `minimax/MiniMax-M2.1` - MiniMax M2.1 (reset 5h)

**Kimi (`kimi/`)** - $9/tháng (10M tokens):
- `kimi/kimi-latest` - Kimi Latest

### Model MIỄN PHÍ (Khẩn cấp)

**iFlow (`if/`)** - 8 models MIỄN PHÍ:
- `if/kimi-k2-thinking` - Kimi K2 Thinking
- `if/qwen3-coder-plus` - Qwen3 Coder Plus
- `if/glm-4.7` - GLM 4.7
- `if/deepseek-r1` - DeepSeek R1

**Qwen (`qw/`)** - 3 models MIỄN PHÍ:
- `qw/qwen3-coder-plus` - Qwen3 Coder Plus
- `qw/qwen3-coder-flash` - Qwen3 Coder Flash

**Kiro (`kr/`)** - 2 models MIỄN PHÍ:
- `kr/claude-sonnet-4.5` - Claude Sonnet 4.5
- `kr/claude-haiku-4.5` - Claude Haiku 4.5

---

## Chiến lược Tối ưu Chi phí

### Ngân sách hàng tháng: $10-20/tháng

```
1. Use Gemini CLI free tier (180K/month) for quick tasks
2. Use Claude Code subscription quota fully (you already pay)
3. Fallback to GLM ($0.6/1M) when quota out
4. Emergency: MiniMax M2.1 ($0.20/1M) or iFlow (free)

Real example (100M tokens/month):
  60M via Gemini CLI: $0 (free tier)
  30M via Claude Code: $0 (subscription you already have)
  8M via GLM: $4.80
  2M via MiniMax: $0.40
  Total: $5.20/month + existing subscriptions
```

### Chiến lược Reset Quota

```
Daily routine:
1. Morning: Fresh Claude Code quota (5h reset)
2. Afternoon: Switch to Gemini CLI (1K/day)
3. Evening: GLM daily quota (reset 10AM next day)
4. Late night: MiniMax (5h rolling) or iFlow (free)

→ Code 24/7 with minimal extra cost!
```

---

## Bước tiếp theo

- [Chi tiết cài đặt](getting-started/installation.md) - Yêu cầu, troubleshooting
- [Tính năng](features/) - Khám phá quota tracking, combos, deployment
- [FAQ](faq.md) - Câu hỏi thường gặp
- [Troubleshooting](troubleshooting.md) - Sửa các vấn đề phổ biến

---

## Cần trợ giúp?

- **Website**: [9router.com](https://9router.com)
- **GitHub**: [github.com/decolua/9router](https://github.com/decolua/9router)
- **Issues**: [github.com/decolua/9router/issues](https://github.com/decolua/9router/issues)
