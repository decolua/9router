Dưới đây là bản dịch tiếng Việt của tài liệu Markdown, giữ nguyên toàn bộ cú pháp và cấu trúc kỹ thuật.

<div align="center">
  <img src="../images/9router.png?1" alt="Bảng điều khiển 9Router" width="800"/>
  
  # 9Router - Free AI Router
  
  **Không bao giờ ngừng code. Tự động định tuyến tới các mô hình AI MIỄN PHÍ & giá rẻ với cơ chế dự phòng thông minh.**
  
  **Nhà cung cấp AI Miễn cho OpenClaw.**
  
  <p align="center">
    <img src="../public/providers/openclaw.png" alt="OpenClaw" width="80"/>
  </p>
  
  [![npm](https://img.shields.io/npm/v/9router.svg)](https://www.npmjs.com/package/9router)
  [![Downloads](https://img.shields.io/npm/dm/9router.svg)](https://www.npmjs.com/package/9router)
  [![License](https://img.shields.io/npm/l/9router.svg)](https://github.com/decolua/9router/blob/main/LICENSE)
  
  [🚀 Bắt đầu nhanh](#-quick-start) • [💡 Tính năng](#-key-features) • [📖 Cài đặt](#-setup-guide) • [🌐 Website](https://9router.com)
</div>

---

## 🤔 Tại sao chọn 9Router?

**Ngừng lãng phí tiền bạc và gặp phải giới hạn:**

- ❌ Hạn mức gói đăng ký hết hạn mỗi tháng mà không dùng hết
- ❌ Giới hạn tốc độ (rate limit) ngăn bạn giữaừng khi code
- ❌ Các API đắt đỏ ($20-50/tháng cho mỗi nhà cung cấp)
- ❌ Phải chuyển đổi thủ công giữa các nhà cung cấp

**9Router giải quyết vấn đề này:**

- ✅ **Tối đa hóa gói đăng ký** - Theo dõi hạn mức, sử dụng từng bit trước khi reset
- ✅ **Tự động dự phòng** - Gói đăng ký → Giá rẻ → Miễn phí, thời gian chết bằng không
- ✅ **Đa tài khoản** - Vòng tròn (round-robin) các tài khoản của mỗi nhà cung cấp
- ✅ **Phổ quát** - Hoạt động với Claude Code, Codex, Gemini CLI, Cursor, Cline, bất kỳ công cụ CLI nào

---

## 🔄 Cách thức hoạt động

```
┌─────────────┐
│  Your CLI   │  (Claude Code, Codex, Gemini CLI, OpenClaw, Cursor, Cline...)
│   Tool      │
└──────┬──────┘
       │ http://localhost:20128/v1
       ↓
┌────────────────────────────────────────┐
│           9Router (Smart Router)        │
│  • Format translation (OpenAI ↔ Claude) │
│  • Quota tracking                       │
│  • Auto token refresh                   │
└──────┬──────────────────────────────────┘
       │
       ├─→ [Tier 1: SUBSCRIPTION] Claude Code, Codex, Gemini CLI
       │   ↓ quota exhausted
       ├─→ [Tier 2: CHEAP] GLM ($0.6/1M), MiniMax ($0.2/1M)
       │   budget limit
       └─→ [Tier 3: FREE] iFlow, Qwen, Kiro (unlimited)

Result: Never stop coding, minimal cost
```

---

## ⚡ Bắt đầu nhanh

**1. Cài đặt toàn cục:**

```bash
npm install -g 9router
9router
```

🎉 Bảng điều khiển mở tại `http://localhost:20128`

**2. Kết nối nhà cung cấp MIỄN PHÍ (không cần đăng ký):**

Bảng điều khiển → Providers -> Kết nối **ude Code** hoặc **Antigravity** -> Đăng nhập OAuth -> Xong!

**3. Sử dụng trong công cụ CLI của bạn:**

```
Cài đặt Claude Code/Codex/Gemini CLI/OpenClaw/Cursor/Cline:
  Endpoint: http://localhost:20128/v1
  API Key: [sao chép từ bảng điều khiển]
  Model: if/kimi-k2-thinking
```

**Xong rồi!** Bắt đầu code với các mô hình AI MIỄN PHÍ.

**Phương án khác: chạy từ nguồn (k lưu trữ này):**

Gói kho lưu trữ này là riêng tư (`9router-app`), vì vậy việc thực thi nguồn/Docker là đường dẫn phát triển cục bộ dự kiến.

```bash
cp .env.example .env
npm install
PORT=20128 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run dev
```

Chế độ Production:

```bash
npm run build
PORT=20128 HOSTNAME=0.0.0.0 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run start
```

URL mặc định:
- Bảng điều khiển: `http://localhost:20128/dashboard`
- API tương thích OpenAI: `http://localhost:20128/v1`

---

## 🎥 Hướng dẫn Video

<div align="center">
  
### 📺 Hướng dẫn thiết lập hoàn chỉnh - 9Router + Claude Code MIỄN PHÍ
  
[![Thiết lập 9Router + Claude Code](https://img.youtube.com/vi/raEyZPg5xE0/maxresdefault.jpg)](https://www.youtube.com/watch?v=raEyZPg5xE0)

**🎬 Xem hướng dẫn từng đầy đủ:**
- ✅ Cài đặt & thiết lập 9Router
- ✅ Cấu hình Claude Sonnet 4.5 MIỄN PHÍ
- ✅ Tích hợp Claude Code
- ✅ Thử nghiệm code trực tiếp

**⏱️ Thời lượng:** 20 phút | **👥 Bởi:** Cộng đồng Nhà phát triển

[▶️ Xem trên YouTube](https://www.youtube.com/watch?v=o3qYCyjrFYg)

</div>

---

## 🛠️ Các công cụ CLI được hỗ trợ

9Router hoạt động liền mạch với tất cả các công cụ code AI chính:

<div align="center">
  <table>
    <tr>
      <td align="center" width="120">
        <img src="../public/providers/claude.png" width="60" alt="Claude Code"/><br/>
        <b>Claude-Code</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/openclaw.png" width="60" alt="OpenClaw"/><br/>
        <b>OpenClaw</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/codex.png" width="60" alt="Codex"/><br/>
        <b>Codex</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/opencode.png" width="60" alt="OpenCode"/><br/>
        <b>OpenCode</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/cursor.png" width="60" alt="Cursor"/><br/>
        <b>Cursor</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/antigravity.png" width="60" alt="Antigravity"/><br/>
        <b>Antigravity</b>
      </td>
    </tr>
    <tr>
      <td align="center" width="120">
        <img src="../public/providers/cline.png" width="60" alt="Cline"/><br/>
        <b>Cline</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/continue.png" width="60" alt="Continue"/><br/>
        <b>Continue</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/droid.png" width="60" alt="Droid"/><br/>
        <b>Droid</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/roo.png" width="60" alt="Roo"/><br/>
        <b>Roo</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/copilot.png" width="60" alt="Copilot"/><br/>
        <b>Copilot</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/kilocode.png" width="60" alt="Kilo Code"/><br/>
        <b>Kilo Code</b>
      </td>
    </tr>
  </table>
</div>

---

##  Các nhà cung cấp được hỗ trợ

### 🔐 Các nhà cung cấp OAuth

<div align="center">
  <table>
    <tr>
      <td align="center" width="120">
        <img src="../public/providers/claude.png" width="60" alt="Claude Code"/><br/>
        <b>Claude-Code</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/antigravity.png" width="60" alt="Antigravity"/><br/>
        <b>Antigravity</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/codex.png" width="60" alt="Codex"/><br/>
        <b>Codex</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/github.png" width="60" alt="GitHub"/><br/>
        <b>GitHub</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/cursor.png" width="60" alt="Cursor"/><br/>
        <b>Cursor</b>
      </td>
    </tr>
  </table>
</div>

### 🆓 Các nhà cung cấp Miễn phí

<div align="center">
  <table>
    <tr>
      <td align="center" width="150">
        <img src="../public/providers/iflow.png" width="70" alt="iFlow"/><br/>
        <b>iFlow AI</b><br/>
        <sub>8+ mô hình • Không giới hạn</sub>
      </td>
      <td align="center" width="150">
        <img src="../public/providers/qwen.png" width="70" alt="Qwen"/><br/>
        <b>Qwen Code</b><br/>
        <sub>3+ mô hình • Không giới hạn</sub>
      </td>
      <td align="center" width="150">
        <img src="../public/providers/gemini-cli.png" width="70" alt="Gemini CLI"/><br/>
        <b>Gemini CLI</b><br/>
        <sub>180K/tháng MIỄN PHÍ</sub>
      </td>
      <td align="center" width="150">
        <img src="../public/providers/kiro.png" width="70" alt="Kiro"/><br/>
        <b>Kiro AI</b><br/>
        <sub>Claude • Không giới hạn</sub>
      </td>
    </tr>
  </table>
</div>

### 🔑 Các nhà cung cấp API Key (40+)

<div align="center">
  <table>
    <tr>
      <td align="center" width="100">
        <img src="../public/providers/openrouter.png" width="50" alt="OpenRouter"/><br/>
        <sub>OpenRouter</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/glm.png" width="50" alt="GLM"/><br/>
        <sub>GLM</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/kimi.png" width="50" alt="Kimi"/><br/>
        <sub>Kimi</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/minimax.png" width="50" alt="MiniMax"/><br/>
        <sub>MiniMax</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/openai.png" width="50" alt="OpenAI"/><br/>
        <sub>OpenAI</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/anthropic.png" width="50" alt="Anthropic"/><br/>
        <sub>Anthropic</sub>
      </td>
    </tr>
    <tr>
      <td align="center" width="100">
        <img src="../public/providers/gemini.png" width="50" alt="Gemini"/><br/>
        <sub>Gemini</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/deepseek.png" width="50" alt="DeepSeek"/><br/>
        <sub>DeepSeek</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/groq.png" width="50" alt="Groq"/><br/>
        <sub>Groq</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/xai.png" width="50" alt="xAI"/><br/>
        <sub>xAI</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/mistral.png" width="50" alt="Mistral"/><br/>
        <sub>Mistral</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/perplexity.png" width="50" alt="Perplexity"/><br/>
        <sub>Perplexity</sub>
      </td>
    </tr>
    <tr>
      <td align="center" width="100">
        <img src="../public/providers/together.png" width="50" alt="Together"/><br/>
        <sub>Together AI</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/fireworks.png" width="50" alt="Fireworks"/><br/>
        <sub>Fireworks</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/cerebras.png" width="50" alt="Cerebras"/><br/>
        <sub>Cerebras</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/cohere.png" width="50" alt="Cohere"/><br/>
        <sub>Cohere</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/nvidia.png" width="50" alt="NVIDIA"/><br/>
        <sub>NVIDIA</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/siliconflow.png" width="50" alt="SiliconFlow"/><br/>
        <sub>SiliconFlow</sub>
      </td>
    </tr>
  </table>
  <p><i>...và hơn 20 nhà cung cấp khác bao gồm Nebius, Chutes, Hyperbolic và các endpoint tương thích OpenAI/Anthropic tùy chỉnh</i></p>
</div>

---

## 💡 Các tính năng chính

| Tính năng | Công dụng | Tại sao nó trọng |
|---------|--------------|----------------|
| 🎯 **Smart 3-Tier Fallback** | Tự động định tuyến: Gói đăng ký → Giá rẻ → Miễn phí | Không bao giờ ngừng code, thời gian chết bằng không |
| 📊 **Theo dõi hạn mức thời gian thực** | Đếm token trực tiếp + đếm ngược reset | Tối đa hóa giá trị gói đăng ký |
| 🔄 **Dịch chuyển định dạng** | OpenAI ↔ Claude ↔ Gemini liền mạch | Hoạt động với mọi công cụ CLI |
| 👥 **Hỗ trợ Đa tài khoản** | Nhiều tài khoản cho mỗi nhà cung cấp | Cân bằng tải + dự phòng |
| 🔄 **Tự động làm mới Token** | Token OAuth tự động làm mới | Không cần đăng nhập lại thủ công |
| 🎨 **Combo tùy chỉnh** | Tạo tổ hợp mô hình không giới hạn | Điều chỉnh dự phòng theo nhu cầu |
| 📝 **Ghi log Request** | Chế độ gỡ lỗi với log request/response đầy đủ | Dễ dàng khắc phục sự cố |
| 💾 **Đồng bộ đám mây** | Đồng bộ cấu hình giữa các thiết bị | Cài đặt giống nhau ở mọi nơi |
| 📊 **Phân tích sử dụng** | Theo dõi token, chi phí, xu hướng theo thời gian | Tối ưu hóa chi tiêu |
| 🌐 **Triển khai ở bất cứ đâu** | Localhost, VPS, Docker, Cloudflare Workers | Tùy chọn triển khai linh hoạt |

<details>
<summary><b>📖 Chi tiết tính năng</b></summary>

### 🎯 Smart 3-Tier Fallback

Tạo combo với tính năng phòng tự động:

```
Combo: "my-coding-stack"
  1. cc/claude-opus-4-6        (gói đăng ký của bạn)
  2. glm/glm-4.7               (backup giá rẻ, $0.6/1M)
  3. if/kimi-k2-thinking       (dự phòng miễn phí)

→ Tự động chuyển đổi khi hết hạn mức hoặc xảy ra lỗi
```

### 📊 Theo dõi hạn mức thời gian thực

- Mức tiêu thụ token cho mỗi nhà cung cấp
- Đếm ngược reset (5 giờ, hàng ngày, hàng tuần)
- Ước tính chi phí cho các tầng trả phí
- Báo cáo chi tiêu hàng tháng

### 🔄 Dịch chuyển định dạng

Dịch chuyển liền mạch giữa các định dạng:
- **OpenAI** ↔ **Claude** ↔ **Gemini** ↔ **OpenAI Responses**
- Công cụ CLI của bạn gửi định dạng OpenAI → 9Router dịch chuyển → Nhà cung cấp nhận định dạng gốc
- Hoạt động với mọi công cụ hỗ trợ endpoint OpenAI tùy chỉnh

### 👥 Hỗ trợ Đa tài khoản

- Thêm nhiều tài khoản cho mỗi nhà cung cấp
- Định tuyến vòng tròn (round-robin) hoặc dựa trên ưu tiên tự động
- Dự phòng sang tài khoản tiếp theo khi một tài khoản chạm hạn mức

### 🔄 Tự động làm mới Token

- Token OAuth tự động làm mới trước khi hết hạn
- Không cần xác thực lại thủ công
- Trải nghiệm liền mạch trên mọi nhà cung cấp

### 🎨 Combo tùy chỉnh

- Tạo tổ hợp mô hình không hạn
- Kết hợp các tầng gói đăng ký, giá rẻ và miễn phí
- Đặt tên combo để dễ truy cập
- Chia sẻ combo giữa các thiết bị với Đồng bộ đám mây

### 📝 Ghi log Request

- Bật chế độ gỡ lỗi để xem log request/response đầy đủ
- Theo dõi các lệnh gọi API, tiêu đề và payload
- Khắc phục sự cố tích hợp
- Xuất log để phân tích

### 💾 Đồng bộ đám mây

- Đồng bộ nhà cung cấp, combo và c đặt giữa các thiết bị
- Tự động đồng bộ nền
- Lưu trữ được mã hóa an toàn
- Truy cập cài đặt của bạn từ bất cứ đâu

#### Ghi chú Runtime Đám mây

- Ưu tiên biến đám mây phía máy chủ trong môi trường production:
  - `BASE_URL` (URL callback nội bộ được sử dụng bởi bộ lập lịch đồng bộ)
  - `CLOUD_URL` (cơ sở endpoint đồng bộ đám mây)
- `NEXT_PUBLIC_BASE_URL` và `NEXT_PUBLIC_CLOUD_URL` vẫn được hỗ trợ để thích/UI, nhưng runtime máy chủ hiện ưu tiên `BASE_URL`/`CLOUD_URL`.
- Các yêu cầu đồng bộ đám mây hiện sử dụng thời gian chờ + hành vi fail-fast để tránh treo UI khi DNS/mạng đám mây không khả dụng.

### 📊 Phân tích sử dụng

- Theo dõi mức sử dụng token theo nhà cung cấp và mô hình
- Ước tính chi phí và xu hướng chi tiêu
- Báo cáo và thông tin chi tiết hàng tháng
- Tối ưu hóa chi tiêu AI của bạn

> **💡AN TRỌNG - Hiểu về Chi phí trên Bảng điều khiển:**
> 
> "Chi phí" hiển thị trong Phân tích sử dụng là **chỉ để theo dõi và so sánh**. 
> Bản thân 9Router **không bao giờ thu phí** bạn bất cứ thứ gì. Bạn chỉ trả tiền trực tiếp cho các nhà cung cấp (nếu sử dụng dịch vụ trả phí).
> 
> **Ví dụ:** Nếu bảng điều khiển của bạn hiển thị "tổng chi phí $290" trong khi sử dụng các mô hìnhFlow, điều này đại diện cho 
> số tiền bạn sẽ phải trả nếu sử dụng API trả phí trực tiếp. Chi phí thực tế của bạn = **$0** (iFlow miễn phí không giới hạn).
> 
> Hãy coi nó như một "trình theo dõi tiết kiệm" cho thấy bạn đang tiết kiệm được bao nhiêu bằng cách sử dụng các mô hình miễn phí hoặc 
> định tuyến qua 9Router!

### 🌐 Triển khai ở bất cứ đâu

- 💻 **Localhost** - Mặc định, hoạt động ngoại tuyến
 ☁️ **VPS/Cloud** - Chia sẻ giữa các thiết bị
- 🐳 **Docker** - Triển khai bằng một lệnh
- 🚀 **Cloudflare Workers** - Mạng edge toàn cầu

</details>

---

## 💰 Tổng quan về giá

| Hạng mục | Nhà cung cấp | Chi phí | Reset Hạn mức | Tốt nhất cho |
|------|----------|------|-------------|----------|
| **💳 GÓI ĐĂNG KÝ** | Claude Code (Pro) | $20/tháng | 5h + hàng tuần | Đã đăng ký rồi |
| | Codex (Plus/Pro) | $20-200/tháng | 5h + hàng tuần | Người dùng OpenAI |
| | Gemini CLI | **MIỄN PHÍ** | 180K/tháng + 1K/ngày | Tất cả mọi người! |
| | GitHub Copilot | $10-19/tháng | Hàng tháng | Người dùng GitHub |
| **💰 GIÁ RẺ** | GLM-4.7 | $0.6/1M | 10AM hàng ngày | Backup ngân sách |
| | MiniMax M21 | $0.2/1M | 5 giờ luân phiên | Lựa chọn rẻ nhất |
| | Kimi K2 | $9/tháng cố định | 10M token/tháng | Chi phí dự đoán được |
| **🆓 MIỄN PHÍ** | iFlow | $0 | Không giới hạn | 8 mô hình miễn phí |
| | Qwen | $0 | Không giới hạn | 3 mô hình miễn phí |
| | Kiro | $0 | Không giới hạn | Claude miễn phí |

**💡 Mẹo Chuyên nghiệp:** Bắt với combo Gemini CLI (180K miễn phí/tháng) + iFlow (không giới hạn miễn phí) = chi phí $0!

---

### 📊 Hiểu về Chi phí & Thanh toán của 9Router

**Thực tế Thanh toán 9Router:**

✅ **Phần mềm 9Router = MIỄN PHÍ mãi mãi** (mã nguồn mở, không bao giờ thu phí)  
✅ **"Chi phí" trên bảng điều khiển = Chỉ để Hiển thị/Theo dõi** (không phải hóa đơn thực tế)  
 **Bạn trả tiền trực tiếp cho nhà cung cấp** (gói đăng ký hoặc phí API)  
✅ **Nhà cung cấp MIỄN PHÍ vẫn MIỄN PHÍ** (iFlow, Kiro, Qwen = $0 không giới hạn)  
❌ **9Router không bao giờ gửi hóa đơn** hoặc tính phí thẻ của bạn

**Cách Hoạt động của Hiển thị Chi phí:**

Bảng điều khiển hiển thị **chi phí ước tính** như thể bạn đang sử dụng API trả phí trực tiếp. Đây **không phải là thanh toán** - đó là công cụ so sánh để cho thấy mức tiết kiệm của bạn.

**Kịch bản Ví dụ:**
```
Hiển thị trên Bảng điều khiển:
• Tổng số Request: 1,662
• Tổng số Token: 47M
• Chi phí Hiển thị: $290

Kiểm tra Thực tế:
• Nhà cung cấp: iFlow (MIỄN PHÍ không giới hạn)
• Thanh toán Thực tế: $0.00
• Ý nghĩa của $290: Số tiền bạn TIẾT KIỆM được bằng cách sử dụng mô hình miễn phí!
```

**Quy tắc Thanh toán:**
- **Nhà cung cấp gói đăng ký** (Claude Code, Codex): Trả tiền trực tiếp cho họ qua website của họ
- **Nhà cung cấp giá rẻ** (GLM, MiniMax): Trả tiền trực tiếp cho họ, 9Router chỉ định tuyến
- **Nhà cung cấp MIỄN PHÍ** (iFlow, Kiro, Qwen): Thực sự miễn phí mãi mãi, không có phí ẩn
- **9**: Không bao giờ thu phí bất cứ thứ gì, ever

---

## 🎯 Trường hợp sử dụng

### Trường hợp 1: "Tôi có gói đăng ký Claude Pro"

**Vấn đề:** Hạn mức hết hạn không dùng, giới hạn tốc độ khi code nặng

**Giải pháp:**
```
Combo: "maximize-claude"
  1. cc/claude-opus-4-6        (sử dụng đầy đủ gói đăng ký)
  2. glm/glm-4.7               (backup giá rẻ khi hết hạn mức  3. if/kimi-k2-thinking       (dự phòng khẩn cấp miễn phí)

Chi phí hàng tháng: $20 (gói đăng ký) + ~$5 (backup) = $25 tổng cộng
so với $20 + chạm giới hạn = sự thất vọng
```

### Trường hợp 2: "Tôi muốn chi phí bằng không"

**Vấn đề:** Không đủ khả năng trả gói đăng ký, cần code AI đáng tin cậy

**Giải pháp:**
```
Combo: "free-forever"
  1. gc/gini-3-flash         (180K miễn phí/tháng)
  2. if/kimi-k2-thinking       (không giới hạn miễn phí)
  3. qw/qwen3-coder-plus       (không giới hạn miễn phí)

Chi phí hàng tháng: $0
Chất lượng: Các mô hình sẵn sàng cho production
```

### Trường hợp 3: "Tôi cần code 24/7, không gián đoạn"

**Vấn đề:** Deadline, không thể để thời gian chết

**Giải pháp:**
```
Combo: "always-on"
  1. cc/claude-opus-4-6        (chất lượng tốt nhất)
  2. cx/gpt-5.2-codex          (gói đăng ký thứ hai)
  3. glm/glm-4.7               (giá rẻ, reset hàng ngày)
  4. minimax/MiniMax-M2.1      (rẻ nhất, reset 5h)
  5. if/kimi-k2-thinking       (miễn phí không giới hạn)

Kết quả: 5 lớp dự phòng = thời gian chết bằng không
Chi phí tháng: $20-200 (gói đăng ký) + $10-20 (backup)
```

### Trường hợp 4: "Tôi muốn AI MIỄN PHÍ trong OpenClaw"

**Vấn đề:** Cần trợ lý AI trong các ứng dụng nhắn tin (WhatsApp, Telegram, Slack...), hoàn toàn miễn phí

**Giải pháp:**
```
Combo: "openclaw-free"
  1. if/glm-4.7                (không giới hạn miễn phí)
  2. if/minimax-m2.1           (không giới hạn phí)
  3. if/kimi-k2-thinking       (không giới hạn miễn phí)

Chi phí hàng tháng: $0
Truy cập qua: WhatsApp, Telegram, Slack, Discord, iMessage, Signal...
```

---

## ❓ Các câu hỏi thường gặp

<details>
<summary><b>📊 Tại sao bảng điều khiển của tôi hiển thị chi phí cao?</b></summary>

Bảng điều khiển theo dõi mức sử dụng token của bạn và hiển thị **chi phí ước tính** như thể bạn đang sử dụng API trả phí trực tiếp. Đâykhông phải là thanh toán thực tế** - đó là tài liệu tham khảo để cho thấy bạn đang tiết kiệm được bao nhiêu bằng cách sử dụng các mô hình miễn phí hoặc gói đăng ký hiện có thông qua 9Router.

**Ví dụ:**
- **Bảng điều khiển hiển thị:** "Tổng chi phí $290"
- **Thực tế:** Bạn đang sử dụng iFlow (MIỄN PHÍ không giới hạn)
- **Chi phí thực tế của bạn:** **$0.00**
- **Ý nghĩa của $290:** Số bạn **tiết kiệm** được bằng cách sử dụng các mô hình miễn phí thay vì API trả phí!

Màn hình chi phí là một "trình theo dõi tiết kiệm" để giúp bạn hiểu các mẫu sử dụng và cơ hội tối ưu hóa.

</details>

<details>
<summary><b>💳 Tôi có bị 9Router tính phí không?</b></summary>

**Không.** 9Router là phần mềm miễn phí, mã nguồn mở chạy trên máy tính của chính bạn. Nó không bao giờ tính phí bạn bất cứ thứ gì.

**Bạn chỉ trả tiền:**
- ✅ **Nhà cung cấp gói đăng ký** (Claude Code $20/tháng, Codex $20-200/tháng) → Trả tiền trực tiếp cho họ trên website của họ
- ✅ **Nhà cung cấp giá rẻ** (GLM, MiniMax) → Trả tiền trực tiếp cho họ, 9Router chỉ định tuyến yêu cầu của bạn
- ❌ **Bản thân 9Router** → **Không bao giờ tính phí bất cứ thứ gì, ever**

9Router là một proxy/router cục bộ. Nó không cóẻ tín dụng của bạn, không thể gửi hóa đơn và không có hệ thống thanh toán. Đó là phần mềm hoàn toàn miễn phí.

</details>

<details>
<summary><b>🆓 Các nhà cung cấp MIỄN PHÍ có thực sự không giới hạn không?</b></summary>

**Có!** Các nhà cung cấp được đánh dấu là MIỄN PHÍ (iFlow, Kiro, Qwen) thực sự không giới hạn với **không có phí ẩn**. 

Đây là các dịch vụ miễn phí được cung cấp bởi các công ty tương ứng:
- **iFlow**: Truy cập miễn phí không giới hạn vào hơn 8 mô hình qua OAuth
- **Kiro**: Các mô hình Claude miễn phí không giới hạn qua AWS Builder ID  
- **Qwen**: Truy cập miễn phí không giới hạn vào các mô hình Qwen qua xác thực thiết bị

9Router chỉ định tuyến yêu cầu của bạn đến họ - không có "cạm bẫy" hay thanh toán trong tương lai. Đó là các dịch vụ thực sự miễn phí, và 9Router giúp chúng dễ sử dụng với hỗ trợ dự phòng.

**Lưu ý:** số nhà cung cấp gói đăng ký (Antigravity, GitHub Copilot) có thể có các khoảng thời gian dùng thử miễn phí có thể trở thành trả phí sau này, nhưng điều này sẽ được các nhà cung cấp đó thông báo rõ ràng, không phải 9Router.

</details>

<details>
<summary><b>💰 Làm thế nào để giảm thiểu chi phí AI thực tế của tôi?</b></summary>

**Chiến lược Ưu tiên Miễn phí:**

1. **Bắt đầu với combo 100% miễn phí:**
   ```
   1. gc/gemini-3-flash (180K/tháng miễn phí từ Google)
   2. if/kimi-k2-thinking (không giới hạn miễn phí từ iFlow)
   3. qw/qwen3-coder-plus (không giới hạn miễn phí từ Qwen)
   ```
   **Chi phí: $0/tháng**

2. **Thêm backup giá rẻ** chỉ khi bạn cần:
   ```
   4. glm/glm-4.7 ($0.6/1M token)
   ```
   **Chi phí bổ sung:** Chỉ trả tiền cho những gì bạn sự sử dụng

3. **Sử dụng nhà cung cấp gói đăng ký cuối cùng:**
   - Chỉ khi bạn đã có chúng
   - 9Router giúp tối đa hóa giá trị của chúng thông qua theo dõi hạn mức

**Kết quả:** Hầu hết người dùng có thể hoạt động ở mức $0/tháng chỉ sử dụng các tầng miễn phí!

</details>

<details>
<summary><b>📈 Điều gì xảy ra nếu mức sử dụng của tôi đột ngột tăng vọt?</b></summary>

Cơ chế dự phòng thông minh của 9Router ngăn chặn các khoản phí bất ngờ:

**Kịch bản:** Bạn đang trong giai đoạn code nước rút và vượt qua các hạn mức

**Không có 9Router:**
- ❌ Chạm giới hạn tốc độ → Công việc dừng lại → Thất vọng
- ❌ Hoặc: Vô tình tích lũy hóa đơn API khổng lồ

**Có 9Router:**
- ✅ Gói đăng ký chạm giới hạn → Tự động dự phòng sang tầng giá rẻ
- ✅ Tầng giá rẻ trở nên đắt đỏ → Tự động dự phòng sang tầng miễn phí
- ✅ Không bao giờ ngừng code → Chi phí dự đoán được

**Bạn nắm quyền kiểm soát:** Đặt giới hạn chi tiêu cho mỗi nhà cung cấp trong bảng điều khiển, và 9Router sẽ tuân thủ chúng.

</details>

---

## 📖 Hướng dẫn thiết lập

<details>
<summary><b>🔐 Các nhà cung cấp Gói đăng ký (Tối đa hóa Giá trị)</b></summary>

### Claude Code (Pro/Max)

```bash
Bảng điều khiển → Providers → Kết nối Claude Code
→ Đăng nhập OAuth → Tự động làm mới token
→ Theo dõi hạn mức 5 giờ + hàng tuần

Các mô hình:
  cc/claude-opus-4-6
  cc/claude-sonnet-4-5-20250929
  cc/claude-haiku-4-5-20251001
```

**Mẹo Chuyên nghiệp:** Sử dụng Opus cho các tác vụ phức tạp, Sonnet cho tốc độ. 9Router theo dõi hạn mức cho mỗi mô hình!

### OpenAI Codex (Plus/Pro)

```bash
Bảng điều khiển → Providers → Kết nối Codex
→ Đăng nhập OAuth (cổng 1455)
→ Reset 5 giờ + hàng tuần

Các mô hình:
  cx/gpt-5.2-codex
  cx/gpt-5.1-codex-max
```

### Gemini CLI (MIỄN PHÍ 180K/tháng!)

```bash
Bảng điều khiển → Providers → Kết nối Gemini CLI
→ Google OAuth
→ 180K hoàn thành/tháng + 1K/ngày

Các hình:
  gc/gemini-3-flash-preview
  gc/gemini-2.5-pro
```

**Giá trị tốt nhất:** Tầng miễn phí khổng lồ! Sử dụng cái này trước các tầng trả phí.

### GitHub Copilot

```bash
Bảng điều khiển → Providers → Kết nối GitHub
→ OAuth qua GitHub
→ Reset hàng tháng (ngày 1 của tháng)

Các mô hình:
  gh/gpt-5
  gh/claude-4.5-sonnet
  gh/gemini-3-pro
`

</details>

<details>
<summary><b>💰 Các nhà cung cấp Giá rẻ (Backup)</b></summary>

### GLM-4.7 (Reset hàng ngày, $0.6/1M)

1. Đăng ký: [Zhipu AI](https://open.bigmodel.cn/)
2. Lấy API key từ Coding Plan
3. Bảng điều khiển → Thêm API Key:
   - Nhà cung cấp: `glm`
   - API Key: `your-key`

**Sử dụng:** `glm/glm-4.7`

**Mẹo Ch nghiệp:** Coding Plan cung cấp hạn mức gấp 3 lần với chi phí 1/7! Reset hàng ngày lúc 10:00 AM.

### MiniMax M2.1 (Reset 5h, $0.20/1M)

1. Đăng ký: [MiniMax](https://www.minimax.io/)
2. Lấy API key
3. Bảng điều khiển → Thêm API Key

**Sử dụng:** `minimax/MiniMax-M2.1`

**Mẹo Chuyên nghiệp:** Lựa chọn rẻ nhất cho ngữ cảnh dài (1M)!

### Kimi K2 ($9/tháng cố định)

1. Đăng ký: [Moonshot AI](https://platform.moonshot.ai/)
2. Lấy API key
3. Bảng điều khiển → Thêm API Key

**Sử dụng:** `kimi/kimi-latest`

**Mẹo Chuyên nghiệp:** Cố định $9/tháng cho 10M token = chi phí thực tế $0.90/1M!

</details>

<details>
<summary><b>🆓 Các nhà cung cấp MIỄN PHÍ (Dự phòng Khẩn cấpb></summary>

### iFlow (8 mô hình MIỄN PHÍ)

```bash
Bảng điều khiển → Kết nối iFlow
→ Đăng nhập OAuth iFlow
→ Sử dụng không giới hạn

Các mô hình:
  if/kimi-k2-thinking
  if/qwen3-coder-plus
  if/glm-4.7
  if/minimax-m2
  if/deepseek-r1
```

### Qwen (3 mô hình MIỄN PHÍ)

```bash
Bảng điều khiển → Kết nối Qwen
 Ủy quyền mã thiết bị
→ Sử dụng không giới hạn

Các mô hình:
  qw/qwen3-coder-plus
  qw/qwen3-coder-flash
```

### Kiro (Claude MIỄN PHÍ)

```bash
Bảng điều khiển → Kết nối Kiro
→ AWS Builder ID hoặc Google/GitHub
→ Sử dụng không giới hạn

Các mô hình:
  kr/claude-sonnet-4.5
  kr/claude-haiku-4.5
```

</details>

<details>
<summary><b>🎨 Tạo Combo</b></summary>

### Ví dụ 1: Tối đa hóa Gói đăng ký → Backup Giá rẻ

```
Bảng điều khiển → Combos → Tạo Mới

Tên: premium-coding
Các mô hình:
  1. cc/claude-opus-4-6 (Gói đăng ký chính)
  2. glm/glm-4.7 (Backup giá rẻ, $0.6/1M)
  3. minimax/MiniMax-M2.1 (Dự phòng rẻ nhất, $0.20/M)

Sử dụng trong CLI: premium-coding

Ví dụ chi phí hàng tháng (100M token):
  80M qua Claude (gói đăng ký): $0 thêm
  15M qua GLM: $9
  5M qua MiniMax: $1
  Tổng: $10 + gói đăng ký của bạn
```

### Ví dụ 2: Chỉ Miễn phí (Chi phí bằng không)

```
Tên: free-combo
Các mô hình:
  1. gc/gemini-3-flash-preview (180K miễn phíáng)
  2. if/kimi-k2-thinking (không giới hạn)
  3. qw/qwen3-coder-plus (không giới hạn)

Chi phí: $0 mãi mãi!
```

</details>

<details>
<summary><b>🔧 Tích hợp CLI</b></summary>

### Cursor IDE

```
Settings → Models → Advanced:
  OpenAI API Base URL: http://localhost:20128/v1
  OpenAI API Key: [từ bảng điều khiển 9router]
  Model: cc/claude-opus-4-6
``Hoặc sử dụng combo: `premium-coding`

### Claude Code

Chỉnh sửa `~/.claude/config.json`:

```json
{
  "anthropic_api_base": "http://localhost:20128/v1",
  "anthropic_api_key": "your-9router-api-key"
}
```

### Codex CLI

```bash
export OPENAI_BASE_URL="http://localhost:20128"
export OPENAI_API_KEY="your-9router-api-key"

codex "prompt của bạn"
```

### OpenClaw

**Phương án 1 — B điều khiển (khuyên dùng):**

```
Bảng điều khiển → CLI Tools → OpenClaw → Chọn Mô hình → Áp dụng
```

**Phương án 2 — Thủ công:** Chỉnh sửa `~/.openclaw/openclaw.json`:

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "9router/if/glm-4.7"
      }
    }
  },
  "models": {
    "providers": {
      "9router": {
        "baseUrl": "://127.0.0.1:20128/v1",
        "apiKey": "sk_9router",
        "api": "openai-completions",
        "models": [
          {
            "id": "if/glm-4.7",
            "name": "glm-4.7"
          }
        ]
      }
    }
  }
}
```

> **Lưu ý:** OpenClaw chỉ hoạt động với 9Router cục bộ. Sử dụng `127.0.0.1` thay vì `localhost` để tránh các vấn đề phân giải6.

### Cline / Continue / RooCode

```
Provider: OpenAI Compatible
Base URL: http://localhost:20128/v1
API Key: [từ bảng điều khiển]
Model: cc/claude-opus-4-6
```

</details>

<details>
<summary><b>🚀 Triển khai</b></summary>

### Triển khai VPS

```bash
# Clone và cài đặt
git clone https://github.com/decolua/9router.git
cd 9router
npm install
npm run build

# Cấu hình
export JWT="your-secure-secret-change-this"
export INITIAL_PASSWORD="your-password"
export DATA_DIR="/var/lib/9router"
export PORT="20128"
export HOSTNAME="0.0.0.0"
export NODE_ENV="production"
export NEXT_PUBLIC_BASE_URL="http://localhost:20128"
export NEXT_PUBLIC_CLOUD_URL="https://9router.com"
export API_KEY_SECRET="endpoint-proxy-api-key-secret"
export MACHINE_ID_SALT="endpoint-proxy-salt"

# Khởi động
npm run start

# Hoặc sử dụng PM2
npm install -g pm2
pm2 start --name 9router -- start
pm2 save
pm2 startup
```

### Docker

```bash
# Build image (từ gốc kho lưu trữ)
docker build -t 9router .

# Chạy container (lệnh được sử dụng trong thiết lập hiện tại)
docker run -d \
  --name 9router \
  -p 20128:20128 \
  --env-file /root/dev/9router/.env \
  -v 9router-data:/app/data \
  -v 9router-usage:/root/.9router \
  9router
```

Lệnh di động (nếu bạn đã ở gốc kho lưu trữ):

```bash
docker run -d \
  --name 9router \
  -p 20128:20128 \
  --env-file ./.env \
  -v 9router-data:/app/data \
  -v 9router-usage:/root/.9router \
  9router
```

Mặc định container:
- `PORT=20128`
- `HOSTNAME=0.0.0.0`

Các lệnh hữu ích:

```bash
docker logs -f 9router
 restart 9router
docker stop 9router && docker rm 9router
```

### Biến môi trường

| Biến | Mặc định | Mô tả |
|----------|---------|-------------|
| `JWT_SECRET` | `9router-default-secret-change-me` | Bí mật ký JWT cho cookie xác thực bảng điều khiển (**thay đổi trong production**) |
| `INITIAL_PASSWORD` | `123456` | Mật khẩu đăng nhập đầu tiên khi không có hash đã lưu tồn tại |
| `DATA_DIR` | `~/.9router` |ị trí cơ sở dữ liệu ứng dụng chính (`db.json`) |
| `PORT` | framework default | Cổng dịch vụ (`20128` trong các ví dụ) |
| `HOSTNAME` | framework default | Bind host (Docker mặc định là `0.0.0.0`) |
| `NODE_ENV` | runtime default | Đặt `production` để triển khai |
| `BASE_URL` | `http://localhost:20128` | URL cơ sở nội bộ phía máy chủ được sử dụng bởi các tác vụ đồng bộ đám mây |
| `CLOUD_URL` | `https://9router.com` | URL cơ sở endpoint đồng bộ đám mây phía máy chủ |
| `NEXT_PUBLIC_BASE_URL` | `http://localhost:3000` | URL cơ sở tương thích ngược/công khai (ưu tiên `BASE_URL` cho runtime máy chủ) |
| `NEXT_PUBLIC_CLOUD_URL` | `https://9router.com` | URL đám mây tương thích ngược/công khai (ưu tiên `CLOUD_URL` cho runtime máy chủ) |
| `API_KEY_SECRET` | `endpoint-proxy-api-key-secret` | B mật HMAC cho các API key được tạo |
| `MACHINE_ID_SALT` | `endpoint-proxy-salt` | Salt cho việc băm ID máy ổn định |
| `ENABLE_REQUEST_LOGS` | `false` | Bật log request/response dưới `logs/` |
| `AUTH_COOKIE_SECURE` | `false` | Buộc cookie xác thực `Secure` (đặt `true` phía reverse proxy HTTPS) |
| `REQUIRE_API_KEY` | `false` | Thực thi Bearer API key trên các route `/v1/*` (khuyên dùng cho triển khai xúc internet) |
| `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` | empty | Proxy gửi đi tùy chọn cho các lệnh gọi nhà cung cấp upstream |

Ghi chú:
- Các biến proxy chữ thường cũng được hỗ trợ: `http_proxy`, `https_proxy`, `all_proxy`, `no_proxy`.
- `.env` không được nướng vào image Docker (`.dockerignore`); tiêm cấu hình runtime với `--env-file` hoặc `-e`.
- Trên Windows, `APPDATA` có thể được sử dụng cho việc phân giải đường dẫn lưuữ cục bộ.
- `INSTANCE_NAME` xuất hiện trong các tài liệu/mẫu env cũ hơn, nhưng hiện không được sử dụng trong runtime.

### Tệp Runtime và Lưu trữ

- Trạng thái ứng dụng chính: `${DATA_DIR}/db.json` (nhà cung cấp, combo, alias, key, cài đặt), được quản lý bởi `src/lib/localDb.js`.
- Lịch sử sử dụng và log: `~/.9router/usage.json` và `~/.9router/log.txt`, được quản lý bởi `src/lib/usageDb.js`.
- request/translator tùy chọn: `<repo>/logs/...` khi `ENABLE_REQUEST_LOGS=true`.
- Lưu trữ sử dụng hiện tại tuân theo logic đường dẫn `~/.9router` và độc lập với `DATA_DIR`.

</details>

---

## 📊 Các mô hình có sẵn

<details>
<summary><b>Xem tất cả các mô hình có sẵn</b></summary>

**Claude Code (`cc/`)** - Pro/Max:
- `cc/claude-opus-4-6`
- `cc/claude-sonnet-4-5-2025029`
- `cc/claude-haiku-4-5-20251001`

**Codex (`cx/`)** - Plus/Pro:
- `cx/gpt-5.2-codex`
- `cx/gpt-5.1-codex-max`

**Gemini CLI (`gc/`)** - MIỄN PHÍ:
- `gc/gemini-3-flash-preview`
- `gc/gemini-2.5-pro`

**GitHub Copilot (`gh/`)**:
- `gh/gpt-5`
- `gh/claude-.5-sonnet`

**GLM (`glm/`)** - $0.6/1M:
- `glm/glm-4.7`

**MiniMax (`minimax/`)** - $0.2/1M:
- `minimax/MiniMax-M2.1`

**iFlow (`if/`)** - MIỄN PHÍ:
- `if/kimi-k2-thinking`
- `if/qwen3-coder-plus`
- `if/deepseek-r1`

**Qwen (`qw/`)** - MIỄN PHÍ:
- `qw/q3-coder-plus`
- `qw/qwen3-coder-flash`

**Kiro (`kr/`)** - MIỄN PHÍ:
- `kr/claude-sonnet-4.5`
- `kr/claude-haiku-4.5`

</details>

---

## 🐛 Khắc phục sự cố

**"Language model did not provide messages"**
- Hết hạn mức nhà cung cấp → Kiểm tra trình theo dõi hạn mức bảng điều khiển
- Giải pháp: Sử dụng dự phòng combo hoặc chuyển sang tầng rẻ hơn

**Gi hạn tốc độ (Rate limiting)**
- Hết hạn mức gói đăng ký → Dự phòng sang GLM/MiniMax
- Thêm combo: `cc/claude-opus-4-6 → glm/glm-4.7 → if/kimi-k2-thinking`

**Token OAuth hết hạn**
- Tự động làm mới bởi 9Router
- Nếu sự cố vẫn tiếp diễn: Bảng điều khiển → Nhà cung cấp → Kết nối lại

**Chi phí cao**
- Kiểm tra thống kê sử dụng trong Bảng điều khiển
- Chuyển mô hình chính sang GLM/MiniMax
- Sử dụng tầng miễn phí (Gemini CLI, iFlow) cho các tác vụ không quan trọng

**Bảng điều khiển mở sai cổng**
- Đặt `PORT=20128` và `NEXT_PUBLIC_BASE_URL=http://localhost:20128`

**Lỗi đồng bộ đám mây**
- Xác minh `BASE_URL` trỏ đến phiên bản đang chạy của bạn (ví dụ: `http://localhost:20128`)
- Xác minh `CLOUD_URL` trỏ đến endpoint đám mây dự kiến của bạn (ví dụ: `https://9router.com`)
- Giữ các giá trị `NEXT_PUBLIC_*` phù hợp với giá trị phía máy chủ khi có thể.

**Endpoint đám mây `stream=false` trả về 500 (`Unexpected token 'd'...`)**
- Triệu chứng thường xuất hiện trên endpoint đám mây công khai (`https://9router.com/v1`) cho các lệnh gọi không phát trực tiếp (non-streaming).
- Nguyên nhân gốc rễ: upstream trả về payload SSE (`data: ...`) trong khi client mong đợi JSON.
-ải pháp thay thế: sử dụng `stream=true` cho các lệnh gọi trực tiếp đến đám mây.
- Runtime 9Router cục bộ bao gồm dự phòng SSE→JSON cho các lệnh gọi không phát trực tiếp khi upstream trả về `text/event-stream`.

**Đám mây báo đã kết nối, nhưng yêu cầu vẫn thất bại với `Invalid API key`**
- Tạo một key mới từ bảng điều khiển cục bộ (`/api/keys`) và chạy đồng bộ đám mây (`Enable Cloud` sau đó `Sync Now`).
- Các key cũ/chưa đồng bộ vẫn có thể trả về `401` trên đám mây ngay cả khi endpoint cục bộ hoạt động.

**Đăng nhập lần đầu không hoạt động**
- Kiểm tra `INITIAL_PASSWORD` trong `.env`
- Nếu chưa đặt, mật khẩu dự phòng là `123456`

**Không có log request dưới `logs/`**
- Đặt `ENABLE_REQUEST_LOGS=true`

---

## 🛠️ Tech Stack

- **Runtime**: Node.js 20+
- **Framework**: Next.js 16
- **UI**: React 19 + Tailwind 4
- **Database**: LowDB (dựa trên tệp JSON)
- **Streaming**: Server-Sent Events (SSE)
- **Auth**: OAuth 2.0 (PKCE) + JWT + API Keys

---

## 📝 Tài liệu tham khảo API

### Chat Completions

```bash
POST http://localhost:20128/v1/chat/completions
Authorization: Bearer your-api-key
Content-Type: application/json

{
  "model": "cc/claude-opus-4-6",
  "messages": [
    {"role":user", "content": "Viết một hàm để..."}
  ],
  "stream": true
}
```

### Liệt kê Mô hình

```bash
GET http://localhost:20128/v1/models
Authorization: Bearer your-api-key

→ Trả về tất cả các mô hình + combo ở định dạng OpenAI
```

### Các Endpoint Tương thích

- `POST /v1/chat/completions`
- `POST /v1/messages`
- `POST /v1/responses`
- `GET /v1/models`
- `POST /v1/messages/count_tokens`
- `GET /v1beta/models`
- `POST /v1beta/models/{...path}` (Gemini-style `generateContent`)
- `POST /v1/api/chat` (đường dẫn chuyển đổi kiểu Ollama)

### Kịch bản Xác thực Đám mây

Đã thêm các kịch bản kiểm tra dưới `tester/security/`:

- `tester/security/test-docker-hardening.sh`
  - Build image Docker và xác thực các kiểm tra hardening (`/api/cloud/auth` auth guard, `REQUIRE_API_KEY`, hành vi cookie xác thực bảo).
- `tester/security/test-cloud-openai-compatible.sh`
  - Gửi một yêu cầu tương thích OpenAI trực tiếp đến endpoint đám mây (`https://9router.com/v1/chat/completions`) với mô hình/key được cung cấp.
- `tester/security/test-cloud-sync-and-call.sh`
  - Quy trình end-to-end: tạo key cục bộ -> bật/đồng bộ đám mây -> gọi endpoint đám mây với thử lại.
  - Bao gồm kiểm tra dự phòng với `stream=true` để phân biệt lỗi xác thực với các vấn đề phân tích phát trực tiếp.

Ghi chú bảo mật cho các kịch bản kiểm tra đám mây:

- Không bao giờ hardcode các API key thực trong kịch bản/commit.
- Chỉ cung cấp key qua các biến môi trường:
  - `API_KEY`, `CLOUD_API_KEY`, hoặc `OPENAI_API_KEY` (được hỗ trợ bởi `test-cloud-openai-compatible.sh`)
- Ví dụ:

```bash
OPENAI_API_KEY="your-cloud-key" bash tester/security/test-cloud-openai-compatible.sh
```

Hành vi dự kiến từ việc xác thực gần đây:

- cục bộ (`http://127.0.0.1:20128/v1/chat/completions`): hoạt động với `stream=false` và `stream=true`.
- Runtime Docker (cùng đường dẫn API được expose bởi container): các kiểm tra hardening đạt, cloud auth guard hoạt động, chế độ API key nghiêm ngặt hoạt động khi được bật.
- Endpoint đám mây công khai (`https://9router.com/v1/chat/completions`):
  - `stream=true`: dự kiến thành công (trả về các khối SSE).
  - `stream=false`: có thể thất bại với `500` + lỗi phân tích (`Unexpected token 'd'`) khi upstream trả về nội dung SSE cho đường dẫn client không phát trực tiếp.

### API Quản lý và Bảng điều khiển

- Xác thực/cài đặt: `/api/auth/login`, `/api/auth/logout`, `/api/settings`, `/api/settings/require-login`
- Quản lý nhà cung cấp: `/api/providers`, `/api/providers/[id]`, `/api/providers/[id]/test`, `/api/providers/[id]/models`, `/api/providers/validate`, `/api/provider-n*`
- Luồng OAuth: `/api/oauth/[provider]/[action]` (+ các import cụ thể theo nhà cung cấp như Cursor/Kiro)
- Cấu hình định tuyến: `/api/models/alias`, `/api/combos*`, `/api/keys*`, `/api/pricing`
- Sử dụng/log: `/api/usage/history`, `/api/usage/logs`, `/api/usage/request-logs`, `/api/usage/[connectionId]`
- Đồng bộ đám mây: `/api/sync/cloud`, `/api/sync/initialize`, `/api/cloud/*`
-ợ giúp CLI: `/api/cli-tools/claude-settings`, `/api/cli-tools/codex-settings`, `/api/cli-tools/droid-settings`, `/api/cli-tools/openclaw-settings`

### Hành vi Xác thực

- Các route Bảng điều khiển (`/dashboard/*`) sử dụng bảo vệ cookie `auth_token`.
- Đăng nhập sử dụng hash mật khẩu đã lưu khi có mặt; nếu không, nó dự phòng vào `INITIAL_PASSWORD`.
- `requireLogin` có thể được chuyển đổi qua `/api/settings/require-login`.

### Xử lý Yêu cầu (C cao)

1. Client gửi yêu cầu đến `/v1/*`.
2. Trình xử lý route gọi `handleChat` (`src/sse/handlers/chat.js`).
3. Mô hình được giải quyết (nhà cung cấp/mô hình trực tiếp hoặc giải quyết alias/combo).
4. Thông tin xác thực được chọn từ DB cục bộ với bộ lọc khả dụng tài khoản.
5. `handleChatCore` (`open-sse/handlers/chatCore.js`) phát hiện định dạng và dịch chuyển yêu cầu.
6. Trình thực thi nhà cung cấp gửi cầu upstream.
7. Luồng được dịch chuyển lại thành định dạng client khi cần.
8. Sử dụng/log được ghi lại (`src/lib/usageDb.js`).
9. Dự phòng áp dụng trên lỗi nhà cung cấp/tài khoản/mô hình theo quy tắc combo.

Tài liệu tham khảo kiến trúc đầy đủ: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

---

## 📧 Hỗ trợ

- **Website**: [9router.com](https://9router.com)
- **GitHub**: [github.com/decolua/9](https://github.com/decolua/9router)
- **Issues**: [github.com/decolua/9router/issues](https://github.com/decolua/9router/issues)

---

## 👥 Người đóng góp

Cảm ơn tất cả những người đã đóng góp giúp 9Router tốt hơn!

[![Contributors](https://contrib.rocks/image?repo=decolua/9router&max=100&columns=20&anon=1)](https://github.com/decolua/9router/graphs/contributors)

---

## 📊 Star Chart

[![ Chart](https://starchart.cc/decolua/9router.svg?variant=adaptive)](https://starchart.cc/decolua/9router)

### Cách Đóng góp

1. Fork kho lưu trữ
2. Tạo nhánh tính năng của bạn (`git checkout -b feature/amazing-feature`)
3. Commit các thay đổi của bạn (`git commit -m 'Add amazing feature'`)
4. Push lên nhánh (`git push origin feature/amazing-feature`)
5. Mở một Pull Request

Xem [CONTRIBUTING.md](CONTRIBUT.md) để biết hướng dẫn chi tiết.

---

## 🔀 Forks

**[OmniRoute](https://github.com/diegosouzapw/OmniRoute)** — Một fork TypeScript đầy đủ tính năng của 9Router. Thêm 36+ nhà cung cấp, tự động dự phòng 4 tầng, API đa phương thức (hình ảnh, embedding, âm thanh, TTS), circuit breaker, bộ nhớ đệm ngữ nghĩa, đánh giá LLM và bảng điều khiển được tinh chỉnh. 368+ bài kiểm tra đơn vị. Có sẵn qua npm và.

---

## 🙏 Lời cảm ơn

Cảm ơn đặc biệt đến **CLIProxyAPI** - bản triển khai Go gốc đã truyền cảm hứng cho bản chuyển đổi JavaScript này.

---

## 📄 Giấy phép

Giấy phép MIT - xem [LICENSE](LICENSE) để biết chi tiết.

---

<div align="center">
  <sub>Được xây dựng với ❤️ cho các nhà phát triển code 24/7</sub>
</div>