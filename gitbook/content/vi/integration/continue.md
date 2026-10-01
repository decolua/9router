# Tích hợp Continue VSCode Extension

Tích hợp 9Router với extension Continue để mang trợ lý AI trực tiếp vào Visual Studio Code.

## Yêu cầu

- Visual Studio Code đã cài đặt
- Extension Continue đã cài đặt từ VSCode marketplace
- 9Router API key từ [dashboard](https://9router.com/dashboard)
- 9Router đang chạy (cục bộ hoặc cloud)

## Các bước Cấu hình

### 1. Mở Continue Configuration

1. Mở VSCode
2. Nhấn `Cmd+Shift+P` (Mac) hoặc `Ctrl+Shift+P` (Windows/Linux)
3. Gõ "Continue: Open Config" và chọn
4. Mở `~/.continue/config.json`

### 2. Thêm Cấu hình Model 9Router

Thêm cấu hình sau vào `config.json`:

**Setup Một Model:**
```json
{
  "models": [
    {
      "title": "9Router - Claude Opus",
      "provider": "openai",
      "model": "cc/claude-opus-4-5-20251101",
      "apiKey": "your-api-key-from-dashboard",
      "apiBase": "http://localhost:20128/v1"
    }
  ]
}
```

**Setup Nhiều Model:**
```json
{
  "models": [
    {
      "title": "9Router - Claude Opus (Best)",
      "provider": "openai",
      "model": "cc/claude-opus-4-5-20251101",
      "apiKey": "your-api-key-from-dashboard",
      "apiBase": "http://localhost:20128/v1"
    },
    {
      "title": "9Router - Claude Sonnet (Balanced)",
      "provider": "openai",
      "model": "cc/claude-sonnet-4-20250514",
      "apiKey": "your-api-key-from-dashboard",
      "apiBase": "http://localhost:20128/v1"
    },
    {
      "title": "9Router - DeepSeek Chat (Code)",
      "provider": "openai",
      "model": "cx/deepseek-chat",
      "apiKey": "your-api-key-from-dashboard",
      "apiBase": "http://localhost:20128/v1"
    },
    {
      "title": "9Router - Claude Haiku (Fast)",
      "provider": "openai",
      "model": "cc/claude-haiku-4-20250514",
      "apiKey": "your-api-key-from-dashboard",
      "apiBase": "http://localhost:20128/v1"
    }
  ]
}
```

**Cho Cloud 9Router:**
Thay `apiBase` bằng:
```json
"apiBase": "https://9router.com/v1"
```

### 3. Lưu và Reload

1. Lưu file cấu hình
2. Reload cửa sổ VSCode: `Cmd+Shift+P` → "Developer: Reload Window"
3. Extension Continue sẽ load cấu hình mới

### 4. Chọn Model

1. Mở sidebar Continue (click icon Continue trong panel trái)
2. Click dropdown chọn model ở trên cùng
3. Chọn model 9Router ưa thích

## Model có sẵn

### Claude Models (Anthropic)
- `cc/claude-opus-4-5-20251101` - Mạnh nhất, tốt nhất cho task phức tạp
- `cc/claude-sonnet-4-20250514` - Cân bằng hiệu năng và tốc độ
- `cc/claude-haiku-4-20250514` - Nhanh nhất, phù hợp task đơn giản

### DeepSeek Models
- `cx/deepseek-chat` - Xuất sắc cho tạo code
- `cx/deepseek-reasoner` - Tốt nhất cho giải quyết vấn đề phức tạp

### GLM Models (Zhipu AI)
- `glm/glm-4-plus` - Tiếng Trung và tiếng Anh nâng cao
- `glm/glm-4-flash` - Phản hồi nhanh

## Ví dụ Sử dụng

### Giải thích Code
1. Chọn code trong editor
2. Mở sidebar Continue
3. Gõ: "Explain this code"
4. Model: `cc/claude-sonnet-4-20250514`

### Tạo Code
1. Mở sidebar Continue
2. Gõ: "Create a React component for user profile card"
3. Model: `cx/deepseek-chat`

### Refactoring
1. Chọn code để refactor
2. Gõ: "Refactor this to use async/await"
3. Model: `cc/claude-sonnet-4-20250514`

### Sửa Bug
1. Chọn code có vấn đề
2. Gõ: "Find and fix the bug in this code"
3. Model: `cx/deepseek-reasoner`

## Cấu hình Nâng cao

### Custom System Prompts

Thêm system prompt tùy chỉnh cho hành vi cụ thể:

```json
{
  "models": [
    {
      "title": "9Router - Code Expert",
      "provider": "openai",
      "model": "cx/deepseek-chat",
      "apiKey": "your-api-key",
      "apiBase": "http://localhost:20128/v1",
      "systemMessage": "You are an expert programmer. Always provide clean, well-documented code with best practices."
    }
  ]
}
```

### Temperature và Parameters

Điều chỉnh hành vi model với parameters:

```json
{
  "models": [
    {
      "title": "9Router - Creative Writer",
      "provider": "openai",
      "model": "cc/claude-opus-4-5-20251101",
      "apiKey": "your-api-key",
      "apiBase": "http://localhost:20128/v1",
      "temperature": 0.9,
      "topP": 0.95
    }
  ]
}
```

### Context Providers

Cấu hình context Continue gửi đến model:

```json
{
  "contextProviders": [
    {
      "name": "code",
      "params": {
        "maxLines": 100
      }
    },
    {
      "name": "diff",
      "params": {}
    },
    {
      "name": "terminal",
      "params": {}
    }
  ]
}
```

## Phím tắt

- `Cmd+L` (Mac) / `Ctrl+L` (Windows/Linux) - Mở Continue chat
- `Cmd+I` (Mac) / `Ctrl+I` (Windows/Linux) - Inline edit
- `Cmd+Shift+R` (Mac) / `Ctrl+Shift+R` (Windows/Linux) - Tạo lại response

## Troubleshooting

### Model không phản hồi
- Kiểm tra 9Router đang chạy: `curl http://localhost:20128/health`
- Xác minh API key trong config.json
- Kiểm tra VSCode Developer Console để xem lỗi: `Help` → `Toggle Developer Tools`

### Chọn sai Model
- Click dropdown model trong sidebar Continue
- Chọn đúng model 9Router
- Tên model phải khớp chính xác (case-sensitive)

### Cấu hình không Load
- Xác minh JSON syntax hợp lệ (dùng JSON validator)
- Kiểm tra vị trí file: `~/.continue/config.json`
- Reload cửa sổ VSCode sau khi thay đổi

### Hiệu năng Chậm
- Chuyển sang model nhanh hơn (haiku, flash)
- Giảm context size trong contextProviders
- Kiểm tra độ trễ network đến 9Router

## Best Practices

### Chiến lược Chọn Model
- **Edit nhanh**: Dùng `cc/claude-haiku-4-20250514`
- **Tạo code**: Dùng `cx/deepseek-chat`
- **Refactoring phức tạp**: Dùng `cc/claude-opus-4-5-20251101`
- **Giải quyết vấn đề**: Dùng `cx/deepseek-reasoner`

### Quản lý Context
- Chỉ chọn code liên quan trước khi hỏi
- Dùng prompt cụ thể, rõ ràng
- Chia task phức tạp thành các bước nhỏ

### Tối ưu Chi phí
- Dùng model nhanh hơn/rẻ hơn cho task đơn giản
- Giới hạn context size khi có thể
- Cache response thường dùng

## Bước tiếp theo

- [Cấu hình Cursor](cursor.md) cho tích hợp IDE nâng cao
- [Setup Roo](roo.md) cho trợ lý AI
- [Khám phá CLI usage](../cli/basic-usage.md)
- [Tìm hiểu về chọn model](../models/overview.md)
