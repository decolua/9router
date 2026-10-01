# Tích hợp Roo AI Assistant

Tích hợp 9Router với Roo AI Assistant để truy cập nhiều model AI qua một giao diện thống nhất.

## Yêu cầu

- Roo AI Assistant đã cài đặt
- 9Router API key từ [dashboard](https://9router.com/dashboard)
- 9Router đang chạy (cục bộ hoặc cloud)

## Các bước Cấu hình

### 1. Mở Roo Settings

Khởi chạy Roo AI Assistant và mở panel settings.

### 2. Cấu hình API Provider

1. Đi đến cài đặt **API Provider**
2. Chọn **Ollama** làm provider type
3. Cấu hình các settings sau:

**Cho 9Router cục bộ:**
```
Base URL: http://localhost:20128/v1
API Key: your-api-key-from-dashboard
```

**Cho 9Router cloud:**
```
Base URL: https://9router.com/v1
API Key: your-api-key-from-dashboard
```

### 3. Chọn Model

Chọn từ các model 9Router có sẵn:

**Claude Models:**
- `cc/claude-opus-4-5-20251101` - Mạnh nhất
- `cc/claude-sonnet-4-20250514` - Cân bằng
- `cc/claude-haiku-4-20250514` - Nhanh

**DeepSeek Models:**
- `cx/deepseek-chat` - Đa năng
- `cx/deepseek-reasoner` - Reasoning phức tạp

**GLM Models:**
- `glm/glm-4-plus` - Nâng cao
- `glm/glm-4-flash` - Phản hồi nhanh

### 4. Test Connection

Gửi tin nhắn test để xác minh tích hợp:

```
Hello! Can you confirm you're connected through 9Router?
```

## Ví dụ Sử dụng

### Chat Cơ bản
```
Ask Roo: "Explain quantum computing in simple terms"
Model: cc/claude-sonnet-4-20250514
```

### Tạo Code
```
Ask Roo: "Write a Python function to calculate Fibonacci numbers"
Model: cx/deepseek-chat
```

### Reasoning Phức tạp
```
Ask Roo: "Analyze the trade-offs between microservices and monolithic architecture"
Model: cx/deepseek-reasoner
```

## Mẹo Chọn Model

- **Task nhanh**: Dùng `cc/claude-haiku-4-20250514` hoặc `glm/glm-4-flash`
- **Hiệu năng cân bằng**: Dùng `cc/claude-sonnet-4-20250514` hoặc `cx/deepseek-chat`
- **Reasoning phức tạp**: Dùng `cc/claude-opus-4-5-20251101` hoặc `cx/deepseek-reasoner`
- **Tối ưu chi phí**: Dùng model DeepSeek hoặc GLM

## Troubleshooting

### Connection Failed
- Xác minh 9Router đang chạy: `curl http://localhost:20128/health`
- Kiểm tra API key đúng
- Đảm bảo Base URL bao gồm hậu tố `/v1`

### Model không khả dụng
- Kiểm tra tên model khớp chính xác (case-sensitive)
- Xác minh model được bật trong 9Router plan
- Thử model khác từ danh sách

### Phản hồi Chậm
- Chuyển sang model nhanh hơn (haiku, flash)
- Kiểm tra kết nối network
- Theo dõi logs 9Router để xem vấn đề

## Cấu hình Nâng cao

### Custom Model Aliases

Bạn có thể tạo shortcut cho model thường dùng trong Roo settings:

```
Alias: "fast" → cc/claude-haiku-4-20250514
Alias: "smart" → cc/claude-opus-4-5-20251101
Alias: "code" → cx/deepseek-chat
```

### Nhiều Profile

Setup profile khác nhau cho use case khác nhau:
- **Development**: Model DeepSeek cho code
- **Writing**: Model Claude cho nội dung
- **Research**: Model Reasoner cho phân tích

## Bước tiếp theo

- [Cấu hình Cursor](cursor.md) cho tích hợp IDE
- [Setup Continue](continue.md) cho VSCode
- [Khám phá CLI usage](../cli/basic-usage.md)
