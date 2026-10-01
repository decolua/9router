# Tích hợp Cursor

Tích hợp 9Router với Cursor IDE để định tuyến request AI qua hệ thống routing thông minh của 9Router.

## Yêu cầu

- Cursor IDE đã cài đặt
- Tài khoản Cursor Pro (cần thiết cho custom API endpoint)
- 9Router cloud endpoint đã cấu hình
- API key từ 9Router dashboard

## ⚠️ Lưu ý Quan trọng

> **Yêu cầu Cloud Endpoint**: Cursor định tuyến request qua server của chính nó và không hỗ trợ endpoint localhost. Bạn phải dùng 9Router cloud endpoint: `https://9router.com`

> **Yêu cầu Cursor Pro**: Tính năng này yêu cầu tài khoản Cursor Pro để dùng custom API endpoint.

## Setup

### 1. Mở Cursor Settings

1. Mở Cursor IDE
2. Đi đến **Settings** (Cmd/Ctrl + ,)
3. Đi đến phần **Models**

### 2. Bật OpenAI API

1. Tìm option **OpenAI API key**
2. Bật toggle để kích hoạt cấu hình custom API

### 3. Cấu hình Base URL

Đặt base URL tới 9Router cloud endpoint:

```
https://9router.com
```

**Các bước:**
1. Trong cài đặt Models, tìm field **Base URL**
2. Nhập: `https://9router.com`
3. Click **Save**

### 4. Thêm API Key

1. Trong field **API Key**, nhập API key 9Router
2. Bạn có thể tìm API key trong 9Router dashboard tại **Settings → API Keys**
3. Click **Save**

### 5. Thêm Custom Model

1. Click nút **View All Models**
2. Click **Add Custom Model**
3. Nhập tên model từ cấu hình 9Router (ví dụ: `gpt-4`, `claude-opus-4-5`, v.v.)
4. Click **Add**

### 6. Chọn Model

1. Trong giao diện chat Cursor, click dropdown chọn model
2. Chọn custom model từ danh sách
3. Bắt đầu dùng 9Router với Cursor!

## Ví dụ Cấu hình

Cursor settings của bạn nên trông như sau:

```
OpenAI API: ✓ Enabled
Base URL: https://9router.com
API Key: sk-9router-xxxxxxxxxxxxx
Custom Models: gpt-4, claude-opus-4-5, gemini-2.0-flash
```

## Model có sẵn

Bạn có thể dùng bất kỳ model nào đã cấu hình trong 9Router dashboard. Ví dụ phổ biến:

| Tên Model | Provider | Mô tả |
|------------|----------|-------------|
| `gpt-4` | OpenAI | GPT-4 Turbo |
| `gpt-4o` | OpenAI | GPT-4 Optimized |
| `claude-opus-4-5` | Anthropic | Claude Opus 4.5 |
| `claude-sonnet-4-5` | Anthropic | Claude Sonnet 4.5 |
| `gemini-2.0-flash` | Google | Gemini 2.0 Flash |

## Sử dụng

### Giao diện Chat

1. Mở Cursor chat (Cmd/Ctrl + L)
2. Chọn model từ dropdown
3. Bắt đầu chat với AI qua 9Router

### Tạo Code Inline

1. Chọn code trong editor
2. Nhấn Cmd/Ctrl + K
3. Nhập prompt
4. Cursor sẽ dùng 9Router để tạo code

### Giải thích Code

1. Chọn code trong editor
2. Nhấn Cmd/Ctrl + L
3. Hỏi "Explain this code"
4. Nhận giải thích AI qua 9Router

## Troubleshooting

### Lỗi "Invalid API Key"

1. Xác minh API key trong 9Router dashboard
2. Đảm bảo bạn sao chép đầy đủ key bao gồm prefix `sk-9router-`
3. Kiểm tra API key chưa hết hạn
4. Thử tạo API key mới

### Lỗi "Model Not Found"

1. Xác minh tên model khớp chính xác với cấu hình 9Router
2. Kiểm tra kết nối provider đang hoạt động trong 9Router dashboard
3. Đảm bảo model có sẵn trong các provider đã kết nối
4. Thử dùng tên model đầy đủ (ví dụ: `openai/gpt-4` thay vì `gpt-4`)

### Lỗi Connection

1. Xác minh bạn đang dùng cloud endpoint: `https://9router.com`
2. Kiểm tra kết nối internet
3. Đảm bảo dịch vụ 9Router cloud đang hoạt động
4. Thử tắt VPN hoặc proxy nếu đang bật

### Localhost không hoạt động

> **Nhớ**: Cursor không hỗ trợ endpoint localhost. Bạn phải dùng cloud endpoint `https://9router.com`. Nếu cần dùng 9Router cục bộ, hãy cân nhắc dùng dịch vụ tunneling như ngrok để expose endpoint cục bộ.

## Setup Cloud Endpoint

Nếu bạn chạy 9Router cục bộ và muốn dùng với Cursor:

1. Bật cloud endpoint trong 9Router settings
2. Cấu hình URL cloud endpoint trong 9Router dashboard
3. Dùng URL cloud trong Cursor settings
4. Đảm bảo 9Router instance cục bộ có thể truy cập từ internet

## Best Practices

1. **Dùng Model Aliases**: Tạo alias ngắn cho model thường dùng trong 9Router
2. **Theo dõi Usage**: Kiểm tra 9Router dashboard để xem thống kê và chi phí
3. **Xoay API Key**: Định kỳ xoay API key để bảo mật
4. **Test Model**: Thử các model khác nhau để tìm model tốt nhất cho use case
