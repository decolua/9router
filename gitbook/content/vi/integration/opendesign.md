# Tích hợp OpenDesign

Tích hợp 9Router với [OpenDesign](https://github.com/Diwak4r/OpenDesign), một AI-native design agent IDE, để định tuyến mọi yêu cầu tạo visual và code qua hệ thống routing thông minh của 9Router.

## Tại sao kết hợp OpenDesign + 9Router

OpenDesign xử lý prompt giống như design spec — input nhận biết hình ảnh, ý định layout, ràng buộc palette và output có cấu trúc. Khi kết hợp với 9Router bạn sẽ có:

- **Iteration an toàn quota** — tiếp tục thiết kế trên các tier subscription/fallback mà không đốt paid seat
- **Multi-model fan-out** — so sánh model có vision và model code-capable trên cùng một brief
- **Auto-fallback** — nếu provider rate-limit giữa chừng iteration, 9Router tự động xoay sang provider kế tiếp đã cấu hình
- **Unified usage telemetry** — xem mọi render, generate và edit request trong một dashboard

## Yêu cầu

- OpenDesign đã cài đặt (CLI hoặc desktop build)
- 9Router đang chạy local **hoặc** đã cấu hình 9Router cloud endpoint
- API key lấy từ 9Router dashboard

> **Lưu ý**: OpenDesign hỗ trợ cả `localhost` lẫn cloud endpoint. Chọn cái nào phù hợp với setup của bạn.

## Setup

### 1. Mở OpenDesign Settings

1. Khởi động OpenDesign
2. Mở **Settings → Providers**
3. Click **Add Custom Provider**

### 2. Cấu hình Base URL

Set base URL cho 9Router endpoint:

**Local 9Router:**
```
http://localhost:20128/v1
```

**Cloud 9Router:**
```
https://9router.com/v1
```

**Các bước:**
1. Trong ô **Base URL**, dán 9Router endpoint của bạn
2. Đảm bảo đường dẫn kết thúc bằng `/v1`

### 3. Thêm API Key

1. Trong ô **API Key**, nhập 9Router API key
2. Tìm nó trong 9Router dashboard ở **Settings → API Keys**
3. Key bắt đầu bằng `sk-9router-`

### 4. Chọn Default Model

OpenDesign cho phép bạn đặt default model cho chat và một default riêng cho generation. Các cặp khuyến nghị:

| Tác vụ | Prefix model | Ví dụ |
|---|---|---|
| Visual reasoning (mặc định) | `cc/` | `cc/claude-sonnet-4-20250514` |
| Iteration nhanh | `glm/` | `glm/glm-4-flash` |
| Code-heavy layout | `cx/` | `cx/deepseek-chat` |

OpenDesign tự động phát hiện tất cả model có trên 9Router instance qua endpoint `/v1/models`.

### 5. Bật Image-Aware Mode

Trong **Settings → Generation**, bật **Image-aware prompts**. Tính năng này wrap ảnh đính kèm thành `image_url` part chuẩn trong OpenAI payload — 9Router chuyển tiếp cho provider phía sau.

### 6. Lưu và Verify

Click **Test Connection**. OpenDesign sẽ gửi `GET /v1/models` đến 9Router. Dấu check xanh nghĩa là routing đã live.

## Configuration Example

Provider entry trong OpenDesign của bạn nên có dạng:

```
Name:        9Router
Base URL:    http://localhost:20128/v1
API Key:     sk-9router-xxxxxxxxxxxxx
Chat Model:  cc/claude-sonnet-4-20250514
Gen Model:   glm/glm-4-plus
Streaming:   on
Image-aware: on
```

## Available Models

Bạn có thể dùng bất kỳ model nào 9Router dashboard expose. Các model phù hợp nhất cho design workflow:

| Model Name | Provider | Phù hợp cho |
|---|---|---|
| `cc/claude-sonnet-4-20250514` | Anthropic | Visual reasoning, layout critique |
| `cc/claude-opus-4-5-20251101` | Anthropic | Spec drafting độ chính xác cao |
| `cx/deepseek-chat` | DeepSeek | Code generation, component scaffold |
| `glm/glm-4-plus` | Zhipu AI | Iteration nhanh, color/palette |
| `gemini/gemini-2.0-flash` | Google | Multi-modal attachments, preview nhanh |

Đổi model theo project ở **Project → Model**.

## Cách dùng

### Chat với Design Context

1. Mở một design file (`.opendsg`, Figma JSON, ảnh hoặc sketch)
2. Mở chat panel (`Cmd/Ctrl + Shift + L`)
3. Reference layer cụ thể: *"Tighten hero padding về 32px và đẩy CTA contrast lên AA"*
4. OpenDesign đính kèm canvas hiện tại làm `image_url` context; 9Router chuyển tiếp cho chat model

### Generate Components

1. Nhấn `Cmd/Ctrl + G` để mở generate dialog
2. Mô tả component: *"Một pricing card 3 tier, sticky CTA, dark mode"*
3. OpenDesign yêu cầu code-capable model qua 9Router và render kết quả inline

### Iterate trên Mock

1. Thả screenshot hoặc wireframe vào canvas
2. Hỏi: *"Tạo phiên bản Tailwind độ trung thực cao của cái này, giữ nguyên spacing"*
3. OpenDesign stream token ngược về qua 9Router; bạn có thể ngắt và điều hướng bất kỳ lúc nào

### Palette và Token Work

1. Chọn một màu trên canvas
2. Hỏi: *"Tạo token scale 12-step quanh base này, perceptually uniform"*
3. Token được sinh ra trở thành named variable có thể tái sử dụng xuyên suốt project

## Troubleshooting

### "Connection Failed"

1. Kiểm tra 9Router đang chạy: `curl http://localhost:20128/health`
2. Xác nhận base URL kết thúc bằng `/v1`
3. Kiểm tra firewall không chặn port 20128
4. Trong OpenDesign, click **Test Connection** lại

### "Invalid API Key"

1. Re-copy key từ 9Router dashboard
2. Xác nhận prefix `sk-9router-` còn nguyên
3. Kiểm tra key chưa bị revoke ở **Settings → API Keys**

### "Model Not Found"

1. Chạy `curl http://localhost:20128/v1/models` và đối chiếu model id chính xác
2. Xác nhận underlying provider đã connect trong 9Router dashboard (status xanh)
3. Thử qualified name: `cc/claude-sonnet-4-20250514` thay vì `claude-sonnet-4`

### Image Attachments Không Được Tôn Trọng

1. Xác nhận **Image-aware prompts** đang bật trong OpenDesign settings
2. Verify active model hỗ trợ vision (xem provider docs)
3. Kiểm tra 9Router log — image part nên xuất hiện dưới `messages[].content[].type == "image_url"`

### First Token Chậm

1. OpenDesign đợi byte đầu tiên trước khi render — prompt lớn làm chậm bước này
2. Bật **Streaming** + dùng model nhanh cho chat, dành model nặng cho generation
3. Pre-warm combo trong 9Router dashboard để fallback path đã sẵn sàng

## Best Practices

1. **Match model với task** — dùng vision-capable model cho visual critique, code model cho scaffold, model nhanh cho palette work
2. **Compose qua combo** — trong 9Router, build combo fan cùng một brief cho hai model và chọn response rẻ hơn mà vẫn valid
3. **Theo dõi quota** — design iteration tốn token; mở dashboard trong lúc làm việc
4. **Tái sử dụng qua project** — pin model + base URL ở project level để các project khác nhau pin tier khác nhau
5. **Rotate API key** — generate `sk-9router-` key mới mỗi 60 ngày

## Tích hợp với 9Router Features

### Smart Routing

9Router chọn provider rẻ nhất còn thỏa model availability và health — hoàn hảo cho tight iteration loop.

### Combos

Chain hai hoặc ba provider để một vision pass Claude có thể fallback sang GLM, rồi Gemini Flash, tất cả mà OpenDesign không nhận ra.

### Quota Tracking

Mỗi render, generate và edit call đều đổ về dashboard ở **Usage**. Lọc theo `provider=opendesign` để cô lập design work.

### Token Savers

Ghép OpenDesign với [RTK](https://github.com/rtk-ai/rtk) hoặc [Headroom](https://github.com/chopratejas/headroom) upstream của 9Router để nén canvas description dài trước khi đẩy cho model.

## Next Steps

- [Khám phá các tích hợp khác](other-tools.md)
- [Thiết lập smart routing](../features/smart-routing.md)
- [Cấu hình combos và fallback](../features/combos.md)
- [Theo dõi quota xuyên suốt provider](../features/quota-tracking.md)