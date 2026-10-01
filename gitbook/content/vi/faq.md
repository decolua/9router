# Câu hỏi thường gặp

Những câu hỏi phổ biến về 9Router.

---

## 9Router là gì?

**9Router là bộ định tuyến mô hình AI giúp tối đa hóa giá trị subscription và giảm chi phí.**

Nó định tuyến request thông minh qua nhiều provider AI bằng hệ thống fallback 3 tầng:
1. **Tầng Subscription** - Tối đa quota Claude Code, Codex, Gemini bạn đang trả tiền
2. **Tầng Cheap** - Lựa chọn siêu rẻ ($0.20-$0.60 per 1M tokens)
3. **Tầng Free** - Backup khẩn cấp với model miễn phí không giới hạn

**Lợi ích chính:**
- Không bao giờ lãng phí quota subscription
- Fallback tự động khi hết quota
- Theo dõi quota thời gian thực
- Tiết kiệm 90% chi phí so với dùng API trực tiếp

---

## Pricing hoạt động thế nào?

**9Router dùng chiến lược pricing 3 tầng:**

### Tier 1: Subscription (Dùng đầu tiên)
- **Claude Code** (Pro/Max): $20-100/tháng - Quota 5 giờ + hàng tuần
- **OpenAI Codex** (Plus/Pro): $20-200/tháng - Quota 5 giờ + hàng tuần
- **Gemini CLI**: MIỄN PHÍ - 180K completions/tháng + 1K/ngày
- **GitHub Copilot**: $10-19/tháng - Reset hàng tháng
- **Antigravity**: MIỄN PHÍ - Tương tự Gemini

**Mục tiêu:** Dùng hết mọi quota trước khi reset!

### Tier 2: Cheap (Backup)
- **GLM-4.7**: $0.60/$2.20 per 1M tokens - Reset 10AM hàng ngày
- **MiniMax M2.1**: $0.20/$1.00 per 1M tokens - 5 giờ rolling
- **Kimi K2**: $9/tháng cố định (10M tokens)

**Mục tiêu:** Rẻ hơn 90% so với ChatGPT API ($20/1M)!

### Tier 3: Free (Khẩn cấp)
- **iFlow**: 8 model MIỄN PHÍ (Kimi K2, Qwen3, GLM, MiniMax...)
- **Qwen**: 3 model MIỄN PHÍ (Qwen3 Coder Plus/Flash, Vision)
- **Kiro**: 2 model MIỄN PHÍ (Claude Sonnet 4.5, Haiku 4.5)

**Mục tiêu:** Fallback chi phí 0 khi mọi thứ khác bị giới hạn quota!

---

## 9Router có miễn phí không?

**Có, 9Router hoàn toàn miễn phí và mã nguồn mở 100%.**

**Provider free tier có sẵn:**
- **Gemini CLI** - 180K completions/tháng (MIỄN PHÍ tài khoản Google)
- **iFlow** - 8 model không giới hạn (MIỄN PHÍ OAuth)
- **Qwen** - 3 model không giới hạn (MIỄN PHÍ OAuth)
- **Kiro** - Claude Sonnet/Haiku (MIỄN PHÍ AWS Builder ID)

**Bạn có thể code MIỄN PHÍ mãi mãi chỉ dùng provider free tier!**

**Provider trả phí tùy chọn:**
- Dịch vụ subscription bạn có thể đã có (Claude Code, Codex, Copilot)
- Lựa chọn siêu rẻ ($0.20-$0.60 per 1M tokens)

---

## Provider nào được hỗ trợ?

### Subscription Providers
- **Claude Code** (Pro/Max) - Claude 4.5 Opus/Sonnet/Haiku
- **OpenAI Codex** (Plus/Pro) - GPT 5.2 Codex, GPT 5.1 Codex Max
- **Gemini CLI** (MIỄN PHÍ) - Gemini 3 Flash/Pro, 2.5 Pro/Flash
- **GitHub Copilot** - GPT-5, Claude 4.5, Gemini 3
- **Antigravity** (Google) - Gemini 3 Pro, Claude Sonnet 4.5

### Cheap Providers
- **GLM** (Zhipu AI) - GLM 4.7, GLM 4.6V Vision
- **MiniMax** - MiniMax M2.1
- **Kimi** (Moonshot AI) - Kimi Latest
- **OpenRouter** - Passthrough đến mọi model OpenRouter

### Free Providers
- **iFlow** - 8 models (Kimi K2, Qwen3, GLM, MiniMax, DeepSeek...)
- **Qwen** - 3 models (Qwen3 Coder Plus/Flash, Vision)
- **Kiro** - 2 models (Claude Sonnet 4.5, Haiku 4.5)

**Tổng: 15+ providers, 50+ models**

Xem [tài liệu providers](providers/subscription.md) để biết chi tiết.

---

## Tôi có thể dùng nhiều provider không?

**Có! Đây là tính năng cốt lõi của 9Router.**

**Combo cho phép bạn nối nhiều provider với fallback tự động:**

```
Example combo: "premium-coding"
1. cc/claude-opus-4-5 (Subscription primary)
2. glm/glm-4.7 (Cheap backup)
3. if/kimi-k2 (Free emergency)

→ Auto-switches when quota exhausted
→ Never stops coding
→ Minimal extra cost
```

**Cách tạo combo:**
```
Dashboard → Combos → Create New
→ Add models in priority order
→ Use combo name in CLI: "premium-coding"
```

**Lợi ích:**
- Zero downtime khi hết quota
- Tối ưu chi phí tự động
- Một tên model cho mọi công cụ

Xem [tài liệu combos](features/combos.md) để biết ví dụ.

---

## Quota tracking hoạt động thế nào?

**9Router theo dõi quota thời gian thực cho tất cả provider:**

**Tính năng:**
- **Token consumption** - Tokens input/output mỗi request
- **Reset countdown** - Thời gian đến khi quota refresh
- **Usage stats** - Báo cáo hàng ngày/tuần/tháng
- **Cost estimation** - Dự kiến chi tiêu (tier trả phí)
- **Quota alerts** - Thông báo khi quota thấp

**Loại quota:**
- **5 giờ rolling** - Claude Code, Codex, MiniMax
- **Reset hàng ngày** - Gemini CLI (1K/ngày), GLM (10AM)
- **Reset hàng tuần** - Claude Code, Codex (quota thêm)
- **Reset hàng tháng** - Gemini CLI (180K), GitHub Copilot (ngày 1)

**Xem quota:**
```
Dashboard → Providers → Quota Tracking
→ Real-time usage + reset countdown
```

Xem [tài liệu quota tracking](features/quota-tracking.md) để biết chi tiết.

---

## 9Router có hoạt động với Cursor không?

**Có, nhưng Cursor yêu cầu endpoint cloud.**

**Vấn đề:** Cursor IDE không hỗ trợ endpoint localhost.

**Giải pháp:** Dùng 9Router cloud deployment:

```
Cursor Settings → Models → Advanced:
  OpenAI API Base URL: https://9router.com/v1
  OpenAI API Key: [from dashboard]
  Model: cc/claude-opus-4-5-20251101
```

**Thay thế:** Self-host trên VPS với domain công khai:
```bash
# Deploy to VPS
git clone https://github.com/decolua/9router.git
cd 9router/app
npm install && npm run build
npm start

# Configure Nginx reverse proxy
# Point Cursor to: https://your-domain.com/v1
```

**Công cụ CLI khác hoạt động với localhost:**
- Cline ✅
- Claude Desktop ✅
- Codex CLI ✅
- Continue ✅
- RooCode ✅

Xem [hướng dẫn tích hợp Cursor](integration/cursor.md) để biết chi tiết.

---

## Tôi có thể self-host 9Router không?

**Có! 9Router hỗ trợ nhiều tùy chọn deployment:**

### Localhost (Mặc định)
```bash
npm install -g 9router
9router
→ Dashboard: http://localhost:3000
→ API: http://localhost:20128/v1
```

### VPS/Cloud
```bash
git clone https://github.com/decolua/9router.git
cd 9router/app
npm install && npm run build

export JWT_SECRET="your-secure-secret"
export INITIAL_PASSWORD="your-password"
export NODE_ENV="production"

npm start
```

### Docker
```bash
docker build -t 9router .
docker run -d \
  -p 3000:3000 \
  -e JWT_SECRET="your-secret" \
  -v 9router-data:/app/data \
  9router
```

### Cloudflare Workers
```bash
cd 9router/app
npm run deploy:cloudflare
```

**Biến môi trường:**
- `JWT_SECRET` - **PHẢI đổi trong production!**
- `DATA_DIR` - Đường dẫn lưu database (mặc định: `~/.9router`)
- `INITIAL_PASSWORD` - Đăng nhập Dashboard (mặc định: `123456`)
- `NODE_ENV` - Đặt `production` để deploy

Xem [hướng dẫn deployment](getting-started/installation.md#deployment) để biết chi tiết.

---

## Dữ liệu của tôi có an toàn không?

**Có, 9Router ưu tiên bảo mật và quyền riêng tư:**

**Local storage:**
- Mọi dữ liệu lưu cục bộ tại `~/.9router` (hoặc `DATA_DIR` tùy chỉnh)
- Không gửi data đến server 9Router
- OAuth tokens mã hóa bằng JWT

**Không telemetry:**
- Không tracking sử dụng
- Không analytics
- Không phone-home

**Mã nguồn mở:**
- Toàn bộ source code có trên GitHub
- Tự audit bảo mật
- Community review

**Best practice:**
- Đổi `JWT_SECRET` trong production
- Dùng `INITIAL_PASSWORD` mạnh
- Bật HTTPS cho cloud deployment
- Xoay API key định kỳ

**9Router lưu gì:**
- Tokens OAuth của provider (mã hóa)
- API keys (mã hóa)
- Thống kê sử dụng (chỉ cục bộ)
- Cấu hình combo

**9Router KHÔNG lưu:**
- Prompts hoặc responses của bạn
- Code bạn tạo
- Thông tin cá nhân

---

## Làm thế nào để cập nhật 9Router?

**Phương thức cập nhật phụ thuộc loại cài đặt:**

### Global NPM Install
```bash
npm update -g 9router
```

### Local Install
```bash
cd 9router/app
git pull origin main
npm install
npm run build
npm start
```

### Docker
```bash
docker pull 9router:latest
docker stop 9router
docker rm 9router
docker run -d \
  -p 3000:3000 \
  -v 9router-data:/app/data \
  9router:latest
```

**Kiểm tra version:**
```bash
9router --version
```

**Breaking changes:**
- Xem [CHANGELOG.md](https://github.com/decolua/9router/blob/main/CHANGELOG.md)
- Backup `~/.9router` trước khi update lớn
- Xem hướng dẫn migration cho major version

---

## Tôi có thể đóng góp như thế nào?

**Chúng tôi hoan nghênh đóng góp!**

### Các cách đóng góp:

1. **Report bugs:**
   - [GitHub Issues](https://github.com/decolua/9router/issues)
   - Bao gồm error logs, các bước reproduce

2. **Request features:**
   - [GitHub Discussions](https://github.com/decolua/9router/discussions)
   - Mô tả use case và lợi ích

3. **Submit code:**
   ```bash
   # Fork repo
   git clone https://github.com/YOUR_USERNAME/9router.git
   cd 9router
   
   # Create branch
   git checkout -b feature/your-feature
   
   # Make changes
   npm install
   npm run dev
   
   # Test
   npm test
   
   # Commit and push
   git add .
   git commit -m "Add your feature"
   git push origin feature/your-feature
   
   # Create Pull Request on GitHub
   ```

4. **Cải thiện docs:**
   - Sửa lỗi chính tả, thêm ví dụ
   - Dịch sang ngôn ngữ khác
   - Viết tutorial

5. **Thêm provider:**
   - Triển khai adapter provider mới
   - Xem `app/lib/providers/` để có ví dụ

**Hướng dẫn đóng góp:**
- Tuân theo code style hiện có
- Thêm test cho tính năng mới
- Cập nhật tài liệu
- Giữ commit nhỏ gọn và mô tả rõ ràng

Xem [CONTRIBUTING.md](https://github.com/decolua/9router/blob/main/CONTRIBUTING.md) để biết chi tiết.

---

## Cần trợ giúp thêm?

- **Documentation:** [9router.com/docs](https://9router.com/docs)
- **GitHub:** [github.com/decolua/9router](https://github.com/decolua/9router)
- **Issues:** [github.com/decolua/9router/issues](https://github.com/decolua/9router/issues)
- **Troubleshooting:** [troubleshooting.md](troubleshooting.md)
