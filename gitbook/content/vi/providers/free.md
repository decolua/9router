# Free Providers - Fallback Chi phí 0

Backup khẩn cấp khi mọi thứ khác bị giới hạn quota. Code 24/7 với chi phí 0!

---

## Tổng quan

Provider free tier là **fallback** khi hết quota subscription và cheap:

- 🆓 **iFlow** - 8 model MIỄN PHÍ (Kimi K2, Qwen3, GLM 4.7, MiniMax M2...)
- 🆓 **Qwen** - 3 model MIỄN PHÍ (Qwen3 Coder Plus/Flash, Vision)
- 🆓 **Kiro** - 2 model MIỄN PHÍ (Claude Sonnet 4.5, Haiku 4.5)

**Chiến lược:** Dùng làm backup khẩn cấp. Usage không giới hạn, miễn phí mãi mãi!

---

## iFlow (8 Model MIỄN PHÍ)

### Pricing

| Plan | Chi phí Hàng tháng | Models | Quota |
|------|--------------|--------|-------|
| FREE | $0 | 8 models | Không giới hạn |

**Giá trị tốt nhất:** Nhiều model nhất trong free tier! Kimi K2, Qwen3, GLM, MiniMax, DeepSeek.

### Setup

**Bước 1: Kết nối qua Dashboard**

```bash
9router
# Dashboard → Providers → Connect iFlow
```

**Bước 2: Đăng nhập OAuth iFlow**

- Click "Connect iFlow"
- Browser mở → trang đăng nhập iFlow
- Tạo tài khoản hoặc đăng nhập
- Cấp quyền
- Auto token refresh được bật

**Bước 3: Dùng trong CLI**

```
Model: if/kimi-k2-thinking
       if/kimi-k2
       if/qwen3-coder-plus
       if/glm-4.7
       if/minimax-m2
       if/deepseek-r1
       if/deepseek-v3.2-chat
       if/deepseek-v3.2-reasoner
```

### Model có sẵn

| Model ID | Mô tả | Tốt nhất cho |
|----------|-------------|----------|
| `if/kimi-k2-thinking` | Kimi K2 Thinking | Reasoning phức tạp |
| `if/kimi-k2` | Kimi K2 | Coding chung |
| `if/qwen3-coder-plus` | Qwen3 Coder Plus | Tạo code |
| `if/glm-4.7` | GLM 4.7 | Tiếng Trung + Anh |
| `if/minimax-m2` | MiniMax M2 | Context dài |
| `if/deepseek-r1` | DeepSeek R1 | Task reasoning |
| `if/deepseek-v3.2-chat` | DeepSeek V3.2 Chat | Conversational |
| `if/deepseek-v3.2-reasoner` | DeepSeek V3.2 Reasoner | Logic phức tạp |

### Mẹo Pro

- **8 model MIỄN PHÍ** - Đa dạng nhất trong free tier
- **Usage không giới hạn** - Không giới hạn quota
- **Kimi K2 Thinking** - Tốt nhất cho reasoning phức tạp
- **DeepSeek R1** - Khả năng reasoning mạnh

---

## Qwen (3 Model MIỄN PHÍ)

### Pricing

| Plan | Chi phí Hàng tháng | Models | Quota |
|------|--------------|--------|-------|
| FREE | $0 | 3 models | Không giới hạn |

### Setup

**Bước 1: Kết nối qua Dashboard**

```bash
9router
# Dashboard → Providers → Connect Qwen
```

**Bước 2: Xác thực Device Code**

- Click "Connect Qwen"
- Dashboard hiển thị device code
- Vào URL xác thực
- Nhập device code
- Đăng nhập tài khoản Qwen
- Auto token refresh được bật

**Bước 3: Dùng trong CLI**

```
Model: qw/qwen3-coder-plus
       qw/qwen3-coder-flash
       qw/vision-model
```

### Model có sẵn

| Model ID | Mô tả | Tốt nhất cho |
|----------|-------------|----------|
| `qw/qwen3-coder-plus` | Qwen3 Coder Plus | Coding nâng cao |
| `qw/qwen3-coder-flash` | Qwen3 Coder Flash | Phản hồi nhanh |
| `qw/vision-model` | Qwen3 Vision | Phân tích ảnh |

### Mẹo Pro

- **Qwen3 Coder Plus** - Khả năng coding mạnh
- **Qwen3 Coder Flash** - Nhanh cho task nhanh
- **Vision model** - Phân tích ảnh MIỄN PHÍ
- **Usage không giới hạn** - Không giới hạn quota

---

## Kiro (Claude MIỄN PHÍ)

### Pricing

| Plan | Chi phí Hàng tháng | Models | Quota |
|------|--------------|--------|-------|
| FREE | $0 | Claude Sonnet 4.5, Haiku 4.5 | Không giới hạn |

**Giá trị tốt nhất:** Claude MIỄN PHÍ! Cùng chất lượng với Claude Code trả phí.

### Setup

**Bước 1: Kết nối qua Dashboard**

```bash
9router
# Dashboard → Providers → Connect Kiro
```

**Bước 2: AWS Builder ID hoặc OAuth**

- Click "Connect Kiro"
- Chọn phương thức đăng nhập:
  - AWS Builder ID (khuyên dùng)
  - Tài khoản Google
  - Tài khoản GitHub
- Cấp quyền
- Auto token refresh được bật

**Bước 3: Dùng trong CLI**

```
Model: kr/claude-sonnet-4.5
       kr/claude-haiku-4.5
```

### Model có sẵn

| Model ID | Mô tả | Tốt nhất cho |
|----------|-------------|----------|
| `kr/claude-sonnet-4.5` | Claude Sonnet 4.5 | Cân bằng chất lượng/tốc độ |
| `kr/claude-haiku-4.5` | Claude Haiku 4.5 | Phản hồi nhanh |

### Mẹo Pro

- **Claude MIỄN PHÍ** - Cùng chất lượng tier trả phí
- **AWS Builder ID** - Setup dễ với tài khoản AWS
- **Usage không giới hạn** - Không giới hạn quota
- **Chất lượng tốt nhất** - Claude 4.5 miễn phí!

---

## So sánh Tính năng

| Provider | Models | Model tốt nhất | Setup | Quota |
|----------|--------|------------|-------|-------|
| **iFlow** | 8 | Kimi K2 Thinking | OAuth | Không giới hạn |
| **Qwen** | 3 | Qwen3 Coder Plus | Device Code | Không giới hạn |
| **Kiro** | 2 | Claude Sonnet 4.5 | AWS Builder ID | Không giới hạn |

**Thắng cuộc:** iFlow vì đa dạng, Kiro vì chất lượng!

---

## Ví dụ Sử dụng

### Setup Cursor IDE

```
Settings → Models → Advanced:
  OpenAI API Base URL: http://localhost:20128/v1
  OpenAI API Key: [from 9router dashboard]
  Model: if/kimi-k2-thinking
```

### Tạo Combo (Khuyên dùng)

```
Dashboard → Combos → Create New

Name: free-combo
Models:
  1. if/kimi-k2-thinking (iFlow primary)
  2. qw/qwen3-coder-plus (Qwen backup)
  3. kr/claude-sonnet-4.5 (Kiro quality)

Use in CLI: free-combo
```

**Kết quả:** Chi phí 0, uptime tối đa!

---

## Chiến lược Fallback Đầy đủ

### Combo 3 Tầng Hoàn chỉnh

```
Dashboard → Combos → Create New

Name: complete-fallback
Models:
  1. gc/gemini-3-flash-preview (FREE subscription)
  2. cc/claude-opus-4-5 (Paid subscription)
  3. glm/glm-4.7 (Cheap backup, $0.6/1M)
  4. minimax/MiniMax-M2.1 (Cheapest, $0.2/1M)
  5. if/kimi-k2-thinking (FREE fallback)
  6. kr/claude-sonnet-4.5 (FREE quality)

Use in CLI: complete-fallback
```

**Kết quả:**
- Tier 1: Subscription MIỄN PHÍ (Gemini CLI)
- Tier 2: Subscription trả phí (Claude Code)
- Tier 3: Backup rẻ (GLM, MiniMax)
- Tier 4: Fallback MIỄN PHÍ (iFlow, Kiro)

**Không bao giờ ngừng code!**

---

## Best Practices

### 1. Dùng làm Backup Khẩn cấp

```
Priority:
1. Subscription tier (maximize paid quota)
2. Cheap tier (pennies per 1M tokens)
3. FREE tier (unlimited, zero cost)

Only use free tier when:
- Subscription quota exhausted
- Budget limit reached
- Testing/non-critical tasks
```

### 2. Chọn Model phù hợp

```
Complex reasoning: if/kimi-k2-thinking
Fast coding: qw/qwen3-coder-flash
Best quality: kr/claude-sonnet-4.5
Long context: if/minimax-m2
Vision tasks: qw/vision-model
```

### 3. Tạo Combo Chỉ Free

```
For zero-cost coding:

Name: zero-cost
Models:
  1. kr/claude-sonnet-4.5 (Best quality)
  2. if/kimi-k2-thinking (Complex tasks)
  3. qw/qwen3-coder-plus (Fast coding)

Cost: $0 forever!
```

### 4. Test Trước Production

```
Use free tier to:
- Test prompts
- Prototype features
- Learn new frameworks
- Non-critical tasks

Save paid quota for:
- Production code
- Complex refactoring
- Critical features
```

---

## Ví dụ Thực tế

### Ví dụ 1: Sinh viên/Người học (Ngân sách 0)

```
Setup:
1. kr/claude-sonnet-4.5 (Best quality)
2. if/kimi-k2-thinking (Complex reasoning)
3. qw/qwen3-coder-plus (Fast coding)

Monthly cost: $0
Usage: Unlimited

Perfect for:
- Learning to code
- Personal projects
- Homework/assignments
```

### Ví dụ 2: Freelancer (Tiết kiệm Ngân sách)

```
Setup:
1. gc/gemini-3-flash-preview (FREE 180K/month)
2. glm/glm-4.7 (Cheap backup, $0.6/1M)
3. if/kimi-k2-thinking (FREE fallback)

Monthly cost: $5-10
Usage: 100M+ tokens

Perfect for:
- Client projects (paid tier)
- Testing (free tier)
- Emergency backup
```

### Ví dụ 3: Heavy User (Tối đa hết tất cả)

```
Setup:
1. gc/gemini-3-flash-preview (FREE 180K/month)
2. cc/claude-opus-4-5 (Subscription $20-100)
3. cx/gpt-5.2-codex (Subscription $20-200)
4. glm/glm-4.7 (Cheap $0.6/1M)
5. minimax/MiniMax-M2.1 (Cheapest $0.2/1M)
6. if/kimi-k2-thinking (FREE unlimited)
7. kr/claude-sonnet-4.5 (FREE quality)

Monthly cost: $40-320 (subscriptions) + $10-20 (cheap tier)
Usage: 500M+ tokens

Perfect for:
- Professional development
- Team projects
- 24/7 coding
```

---

## So sánh Chi phí

### Kịch bản: 100M tokens/tháng

**Phương án 1: Chỉ ChatGPT API**
```
100M × $20/1M = $2,000/month
```

**Phương án 2: Chỉ 9Router Free Tier**
```
100M via free tier = $0/month
Savings: $2,000/month (100%)
```

**Phương án 3: Chiến lược Hoàn chỉnh 9Router**
```
60M via Gemini CLI (FREE): $0
30M via Claude Code (subscription): $0 extra
8M via GLM (cheap): $4.80
2M via iFlow (FREE): $0
Total: $4.80/month + subscriptions you already have
Savings: $1,995/month (99.76%)
```

---

## Troubleshooting

### "OAuth failed"

**Giải pháp:**
- Kiểm tra kết nối internet
- Thử browser khác
- Xóa cache browser
- Kết nối lại trong dashboard

### "Model not available"

**Giải pháp:**
- Kiểm tra provider đã kết nối trong dashboard
- Xác minh OAuth token hợp lệ
- Kết nối lại provider nếu cần

### "Slow responses"

**Giải pháp:**
- Free tier có thể có ưu tiên thấp hơn
- Dùng trong giờ thấp điểm
- Chuyển sang free provider khác
- Nâng cấp lên cheap tier để tăng tốc

---

## Giới hạn

### Cân nhắc Free Tier

- **Tốc độ** - Có thể chậm hơn tier trả phí
- **Ưu tiên** - Ưu tiên thấp hơn trong giờ cao điểm
- **Rate limit** - Có thể bị rate limit (nhưng không giới hạn quota)
- **Tính khả dụng** - Có thể có downtime thỉnh thoảng

**Giải pháp:** Dùng chiến lược fallback 3 tầng để đáng tin cậy!

---

## Bước tiếp theo

- **Setup subscriptions:** [Subscription Providers](./subscription.md)
- **Thêm cheap backup:** [Cheap Providers](./cheap.md)
- **Tạo combos:** Dashboard → Combos → Create New
- **Bắt đầu code:** Dùng combo `complete-fallback` để có độ tin cậy tối đa
