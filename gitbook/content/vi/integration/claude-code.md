# Tích hợp Claude Code

Tích hợp ebRouter với Claude Code CLI để định tuyến request API Anthropic qua hệ thống routing thông minh của ebRouter.

## Yêu cầu

- Claude Code CLI đã cài đặt
- ebRouter đang chạy cục bộ hoặc cloud endpoint đã cấu hình
- API key từ ebRouter dashboard

## Setup

### 1. Cấu hình biến môi trường

Đặt các biến môi trường sau trong file cấu hình shell (`~/.bashrc`, `~/.zshrc`, hoặc `~/.bash_profile`):

```bash
# Base URL for ebRouter
export ANTHROPIC_BASE_URL="http://localhost:20128/v1"

# Optional: Set default models for aliases
export ANTHROPIC_DEFAULT_OPUS_MODEL="cc/claude-opus-4-5-20251101"
export ANTHROPIC_DEFAULT_SONNET_MODEL="cc/claude-sonnet-4-5-20250929"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="cc/claude-haiku-4-5-20251001"
```

### 2. Reload Shell Configuration

```bash
source ~/.zshrc  # or ~/.bashrc
```

### 3. Xác minh Cấu hình

Kiểm tra các biến môi trường đã set đúng:

```bash
echo $ANTHROPIC_BASE_URL
```

## Model Aliases

Claude Code hỗ trợ các alias model sau ánh xạ sang model ebRouter:

| Alias | Model | Biến môi trường |
|-------|-------|---------------------|
| `opus` | Claude Opus 4.5 | `ANTHROPIC_DEFAULT_OPUS_MODEL` |
| `sonnet` | Claude Sonnet 4.5 | `ANTHROPIC_DEFAULT_SONNET_MODEL` |
| `haiku` | Claude Haiku 4.5 | `ANTHROPIC_DEFAULT_HAIKU_MODEL` |

## Ví dụ Sử dụng

### Dùng Model Aliases

```bash
# Use Opus model
claude --model opus "Explain quantum computing"

# Use Sonnet model
claude --model sonnet "Write a Python function"

# Use Haiku model
claude --model haiku "Quick code review"
```

### Dùng Full Model Names

```bash
claude --model cc/claude-opus-4-5-20251101 "Your prompt here"
```

## File Settings

Claude Code lưu cấu hình trong `~/.claude/settings.json`. Bạn có thể sửa file này thủ công nếu cần:

```json
{
  "baseUrl": "http://localhost:20128/v1",
  "defaultModel": "sonnet"
}
```

## Troubleshooting

### Lỗi Connection

Nếu gặp lỗi kết nối:

1. Xác minh ebRouter đang chạy: `curl http://localhost:20128/health`
2. Kiểm tra biến môi trường đã set đúng
3. Đảm bảo không firewall nào chặn port 20128

### Model Not Found

Nếu gặp lỗi "model not found":

1. Xác minh tên model khớp với cấu hình ebRouter
2. Kiểm tra kết nối provider đang hoạt động trong ebRouter dashboard
3. Đảm bảo model có sẵn trong các provider đã kết nối

## Cloud Endpoint

Để dùng ebRouter cloud endpoint thay vì localhost:

```bash
export ANTHROPIC_BASE_URL="https://ebrouter.example.com"
```

Đảm bảo bạn đã cấu hình API key trong ebRouter cloud dashboard.
