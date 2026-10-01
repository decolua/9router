# Tích hợp Cline

Tích hợp 9Router với extension Cline VSCode để định tuyến request AI qua hệ thống routing thông minh của 9Router.

## Yêu cầu

- Visual Studio Code đã cài đặt
- Extension Cline đã cài đặt từ VSCode marketplace
- 9Router đang chạy cục bộ hoặc cloud endpoint đã cấu hình
- API key từ 9Router dashboard

## Setup

### 1. Mở Cline Settings

1. Mở Visual Studio Code
2. Mở panel extension Cline (click icon Cline trong sidebar)
3. Click icon **Settings** (icon bánh răng) trong panel Cline

### 2. Chọn API Provider

1. Trong Cline settings, tìm dropdown **API Provider**
2. Chọn **Ollama** từ danh sách
   - Lưu ý: Chúng ta dùng provider type Ollama vì nó tương thích với API kiểu OpenAI

### 3. Cấu hình Base URL

Đặt base URL tới endpoint 9Router:

**Cho 9Router cục bộ:**
```
http://localhost:20128/v1
```

**Cho 9Router cloud:**
```
https://9router.com
```

**Các bước:**
1. Trong field **Base URL**, nhập endpoint 9Router
2. Đảm bảo bao gồm `/v1` ở cuối

### 4. Thêm API Key

1. Trong field **API Key**, nhập API key 9Router của bạn
2. Bạn có thể tìm API key trong 9Router dashboard tại **Settings → API Keys**
3. Key bắt đầu bằng `sk-9router-`

### 5. Chọn Model

1. Trong dropdown **Model**, bạn có thể:
   - Chọn từ model có sẵn (nếu Cline auto-detect)
   - Nhập tên model thủ công từ cấu hình 9Router

2. Tên model phổ biến:
   - `gpt-4`
   - `gpt-4o`
   - `claude-opus-4-5`
   - `claude-sonnet-4-5`
   - `gemini-2.0-flash`

### 6. Lưu Cấu hình

Click **Save** hoặc đóng panel settings. Cline sẽ tự lưu cấu hình.

## Ví dụ Cấu hình

Cline settings của bạn nên trông như sau:

```
API Provider: Ollama
Base URL: http://localhost:20128/v1
API Key: sk-9router-xxxxxxxxxxxxx
Model: gpt-4
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

### Chat với AI

1. Mở panel Cline trong VSCode
2. Gõ tin nhắn vào input chat
3. Nhấn Enter để gửi
4. Cline sẽ dùng 9Router để xử lý request

### Tạo Code

1. Yêu cầu Cline tạo code: "Create a React component for a login form"
2. Cline sẽ tạo code qua 9Router
3. Xem và chấp nhận code được tạo

### Giải thích Code

1. Chọn code trong editor
2. Hỏi Cline: "Explain this code"
3. Nhận giải thích AI qua 9Router

### Thao tác File

1. Yêu cầu Cline tạo, sửa hoặc xóa files
2. Cline sẽ dùng 9Router để hiểu context và thực hiện thay đổi
3. Xem thay đổi trước khi chấp nhận

## Troubleshooting

### Lỗi "Connection Failed"

1. Xác minh 9Router đang chạy: `curl http://localhost:20128/health`
2. Kiểm tra base URL đúng và bao gồm `/v1`
3. Đảm bảo không firewall nào chặn port 20128
4. Thử khởi động lại VSCode

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

### Cline không phản hồi

1. Kiểm tra panel output Cline để xem thông báo lỗi
2. Xác minh 9Router instance đang chạy và healthy
3. Thử reload cửa sổ VSCode (Cmd/Ctrl + Shift + P → "Reload Window")
4. Kiểm tra logs 9Router để xem lỗi

## Cấu hình Nâng cao

### Dùng Cloud Endpoint

Để dùng 9Router cloud endpoint thay vì localhost:

1. Trong Cline settings, đặt Base URL: `https://9router.com`
2. Đảm bảo bạn đã cấu hình API key trong 9Router cloud dashboard
3. Đảm bảo cloud endpoint đang hoạt động và truy cập được

### Nhiều Model

Bạn có thể chuyển nhanh giữa các model:

1. Mở Cline settings
2. Đổi field **Model** sang model khác
3. Lưu và tiếp tục chat với model mới

### Custom Timeout

Nếu gặp vấn đề timeout với request lớn:

1. Mở VSCode settings (Cmd/Ctrl + ,)
2. Tìm "Cline timeout"
3. Tăng giá trị timeout (mặc định thường là 30 giây)

## Best Practices

1. **Dùng Model phù hợp**: Chọn model nhanh (như Haiku hoặc Flash) cho task đơn giản, model mạnh hơn (như Opus hoặc GPT-4) cho task phức tạp
2. **Theo dõi Usage**: Kiểm tra 9Router dashboard để xem thống kê và chi phí
3. **Quản lý Context**: Giữ cuộc trò chuyện tập trung để giảm token usage
4. **Chuyển Model**: Chuyển model dựa trên độ phức tạp task để tối ưu chi phí và hiệu năng
5. **Bảo mật API Key**: Không bao giờ commit API key vào version control

## Tích hợp với Tính năng 9Router

### Định tuyến Model

9Router tự động định tuyến request đến provider tốt nhất hiện có dựa trên:
- Tính khả dụng của model
- Trạng thái sức khỏe provider
- Tối ưu chi phí
- Load balancing

### Hỗ trợ Fallback

Nếu một provider thất bại, 9Router tự động fallback sang provider khác đã cấu hình trong dashboard.

### Theo dõi Usage

Giám sát usage Cline qua 9Router dashboard:
- Tổng request
- Token usage
- Chi phí mỗi model
- Phân bổ provider
