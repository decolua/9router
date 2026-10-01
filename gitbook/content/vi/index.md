# Chào mừng đến với 9Router

**Dùng Claude, Codex, Gemini MIỄN PHÍ • Lựa chọn siêu rẻ từ $0.20/1M tokens**

9Router là bộ định tuyến mô hình AI giúp tối đa hóa giá trị subscription và giảm chi phí thông qua định tuyến thông minh và fallback tự động.

---

## 9Router là gì?

9Router là một proxy thông minh nằm giữa các công cụ lập trình của bạn (Cursor, Cline, Claude Desktop) và các nhà cung cấp AI. Nó tự động định tuyến request đến model tốt nhất hiện có dựa trên quota, chi phí và tính khả dụng.

**Đừng lãng phí tiền:**
- ❌ Quota subscription hết hạn mỗi tháng mà không dùng đến
- ❌ Rate limit chặn bạn đang lập trình
- ❌ API đắt đỏ ($20-50/tháng cho mỗi provider)
- ❌ Chuyển đổi provider thủ công

**Bắt đầu tối đa hóa giá trị:**
- ✅ **Tối đa Subscription** - Theo dõi và dùng từng chút quota của Claude Code, Codex, Gemini
- ✅ **MIỄN PHÍ** - Truy cập model iFlow, Qwen, Kiro qua CLI
- ✅ **Backup siêu rẻ** - GLM ($0.6/1M), MiniMax M2.1 ($0.20/1M)
- ✅ **Smart Fallback** - Subscription → Cheap → Free, chuyển đổi tự động

---

## Tính năng chính

### 🔄 Smart 3-Tier Fallback

```
Setup once, never stop coding:

Tier 1 (SUBSCRIPTION): Claude Code → Codex → Gemini
  ↓ quota exhausted
Tier 2 (CHEAP): GLM-4.7 → MiniMax M2.1 → Kimi
  ↓ budget limit
Tier 3 (FREE): iFlow → Qwen → Kiro

→ Automatic switching, zero downtime!
```

### 📊 Theo dõi Quota

- Tiêu thụ token thời gian thực cho mỗi provider
- Đếm ngược reset (5 giờ, hàng ngày, hàng tuần, hàng tháng)
- Ước tính chi phí cho tier trả phí
- Báo cáo chi tiêu hàng tháng

### 🎯 Hỗ trợ CLI Toàn diện

Hoạt động với mọi công cụ hỗ trợ custom OpenAI endpoint:

✅ **Cursor** • **Cline** • **Claude Desktop** • **Codex** • **RooCode** • **Continue** • **Bất kỳ tool nào tương thích OpenAI**

### 💰 Tối ưu Chi phí

**Ví dụ thực tế (100M tokens/tháng):**
```
60M qua Gemini CLI: $0 (free tier)
30M qua Claude Code: $0 (subscription đã có)
8M qua GLM: $4.80
2M qua MiniMax: $0.40
Tổng: $5.20/tháng so với $2000 trên ChatGPT API!
```

---

## Tại sao chọn 9Router?

### Tối đa hóa Subscription

Đã trả tiền cho Claude Code ($20-100/tháng) hoặc Codex ($20-200/tháng)? Nhận giá trị đầy đủ:

- Theo dõi sử dụng quota thời gian thực
- Tự động chuyển khi quota reset (5 giờ, hàng tuần)
- Dùng hết mọi token trước khi hết hạn
- Gemini CLI: 180K completions/tháng **MIỄN PHÍ**

### Backup Siêu Rẻ

Khi quota subscription hết, trả vài xu:

| Provider | Giá per 1M tokens | Reset |
|----------|-------------------|-------|
| **GLM-4.7** | $0.60 input / $2.20 output | Hàng ngày 10:00 AM |
| **MiniMax M2.1** | $0.20 input / $1.00 output | 5 giờ rolling |
| **Kimi K2** | $9/tháng (10M tokens) | Hàng tháng |

**~90% rẻ hơn ChatGPT API ($20/1M)!**

### Fallback Miễn phí Mãi mãi

Backup khẩn cấp khi mọi thứ khác đều bị giới hạn quota:

- **iFlow**: 8 models (Kimi K2, Qwen3 Coder Plus, GLM 4.7, MiniMax M2)
- **Qwen**: 3 models (Qwen3 Coder Plus/Flash, Vision)
- **Kiro**: Claude Sonnet 4.5, Haiku 4.5 (AWS Builder ID)

---

## Bắt đầu nhanh

Bắt đầu trong 2 phút:

```bash
# Install globally
npm install -g 9router

# Start (dashboard opens automatically)
9router
```

🎉 **Dashboard mở** → Kết nối provider → Bắt đầu code!

**Dùng trong CLI tool:**

```
Endpoint: http://localhost:20128/v1
API Key: [from dashboard]
Model: cc/claude-opus-4-5-20251101
```

[→ Hướng dẫn Bắt đầu đầy đủ](getting-started.md)

---

## Trường hợp sử dụng

### Cho Developer cá nhân

- Tối đa hóa subscription Claude Code/Codex
- Dùng Gemini CLI free tier (180K/tháng)
- Fallback sang model siêu rẻ ($0.20/1M)
- Code 24/7 không bị rate limit

### Cho Team

- Triển khai trên VPS/Cloud để chia sẻ truy cập
- Theo dõi chi tiêu team thời gian thực
- Đặt giới hạn ngân sách cho mỗi tier
- Quản lý provider tập trung

### Cho Mobile/Remote Coding

- Dùng cloud deployment (https://9router.com)
- Truy cập từ iPad, điện thoại, mọi nơi
- Không bị giới hạn localhost
- Mạng Cloudflare edge (300+ vị trí)

---

## Tiếp theo là gì?

- [Bắt đầu](getting-started.md) - Cài đặt và cấu hình trong 5 phút
- [Hướng dẫn cài đặt](getting-started/installation.md) - Hướng dẫn setup chi tiết
- [Tính năng](features/) - Khám phá mọi khả năng
- [FAQ](faq.md) - Các câu hỏi thường gặp

---

<div align="center">
  <sub>Built with ❤️ for developers maximizing AI value</sub>
</div>
