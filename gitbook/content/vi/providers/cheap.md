# Cheap Providers - Backup Siêu Rẻ

Khi hết quota subscription, trả vài xu thay vì vài đô. Rẻ hơn ChatGPT API ~90%!

---

## Tổng quan

Provider tier rẻ là **backup** khi hết quota subscription:

- 💰 **GLM-4.7** - $0.6/$2.2 per 1M tokens (reset hàng ngày)
- 💰 **MiniMax M2.1** - $0.2/$1.0 per 1M tokens (reset 5h)
- 💰 **Kimi K2** - $9/tháng cố định (10M tokens)

**Chiến lược:** Dùng sau khi hết quota subscription, trước free tier. Tiết kiệm chi phí khổng lồ so với ChatGPT API ($20/1M).

---

## GLM-4.7 (Reset Hàng ngày)

### Pricing

| Tier | Input | Output | Reset |
|------|-------|--------|-------|
| Standard | $0.60/1M | $2.20/1M | Hàng ngày 10:00 AM |
| Coding Plan | $0.60/1M | $2.20/1M | Hàng ngày 10:00 AM (3× quota) |

**Ví dụ Chi phí (10M tokens):**
- Input: 10M × $0.60 = $6
- Output: 10M × $2.20 = $22
- **Tổng: $6-22** so với $200 trên ChatGPT API!

### Setup

**Bước 1: Đăng ký**

1. Vào [Zhipu AI](https://open.bigmodel.cn/)
2. Tạo tài khoản (xác thực số điện thoại)
3. Chọn **Coding Plan** để có quota 3× ở cùng giá

**Bước 2: Lấy API Key**

```bash
Dashboard → API Keys → Create New
→ Copy API key (starts with "zhipu-")
```

**Bước 3: Thêm vào 9Router**

```bash
9router
# Dashboard → Providers → Add API Key

Provider: glm
API Key: zhipu-your-api-key-here
```

**Bước 4: Dùng trong CLI**

```
Model: glm/glm-4.7
       glm/glm-4.6v (vision)
```

### Model có sẵn

| Model ID | Mô tả | Context | Tốt nhất cho |
|----------|-------------|---------|----------|
| `glm/glm-4.7` | GLM 4.7 | 128K | Coding, task chung |
| `glm/glm-4.6v` | GLM 4.6V Vision | 128K | Phân tích ảnh |

### Mẹo Pro

- **Coding Plan** - 3× quota cùng giá ($0.6/$2.2)
- **Reset hàng ngày** - Quota mới lúc 10:00 AM giờ Bắc Kinh
- **Tốt nhất cho coding** - Tối ưu cho code generation
- **Context 128K** - Xử lý file lớn

### Reset Quota

```
Daily reset: 10:00 AM Beijing Time (UTC+8)
→ 2:00 AM UTC
→ 6:00 PM PST (previous day)
→ 9:00 PM EST (previous day)

Plan your heavy tasks around reset time!
```

---

## MiniMax M2.1 (Reset 5 Giờ)

### Pricing

| Tier | Input | Output | Reset |
|------|-------|--------|-------|
| Standard | $0.20/1M | $1.00/1M | 5 giờ rolling |

**Ví dụ Chi phí (10M tokens):**
- Input: 10M × $0.20 = $2
- Output: 10M × $1.00 = $10
- **Tổng: $2-10** - Lựa chọn rẻ nhất!

### Setup

**Bước 1: Đăng ký**

1. Vào [MiniMax](https://www.minimax.io/)
2. Tạo tài khoản
3. Xác thực email/điện thoại

**Bước 2: Lấy API Key**

```bash
Dashboard → API Management → Create Key
→ Copy API key
```

**Bước 3: Thêm vào 9Router**

```bash
9router
# Dashboard → Providers → Add API Key

Provider: minimax
API Key: your-minimax-api-key
```

**Bước 4: Dùng trong CLI**

```
Model: minimax/MiniMax-M2.1
```

### Model có sẵn

| Model ID | Mô tả | Context | Tốt nhất cho |
|----------|-------------|---------|----------|
| `minimax/MiniMax-M2.1` | MiniMax M2.1 | 1M tokens | Context dài, coding |

### Mẹo Pro

- **Lựa chọn rẻ nhất** - $0.20/1M input (rẻ hơn ChatGPT 90%)
- **5 giờ rolling** - Quota reset mỗi 5 giờ
- **Context 1M** - Cửa sổ context khổng lồ
- **Tốt nhất cho file dài** - Xử lý cả codebase

### Reset Quota

```
5-hour rolling window:
→ Use quota → Wait 5 hours → Fresh quota

Example:
10:00 AM - Use 5M tokens
3:00 PM - Fresh quota available
8:00 PM - Fresh quota available

Code 24/7 with minimal cost!
```

---

## Kimi K2 (Cố định $9/tháng)

### Pricing

| Plan | Chi phí Hàng tháng | Tokens bao gồm | Chi phí Hiệu quả |
|------|--------------|-----------------|----------------|
| Subscription | $9 | 10M tokens | $0.90/1M |

**Ví dụ Chi phí:**
- $9/tháng cố định
- 10M tokens bao gồm
- **Hiệu quả: $0.90/1M** - Giá trị tốt nhất cho sử dụng đều!

### Setup

**Bước 1: Đăng ký**

1. Vào [Moonshot AI](https://platform.moonshot.ai/)
2. Tạo tài khoản
3. Đăng ký plan $9/tháng

**Bước 2: Lấy API Key**

```bash
Dashboard → API Keys → Create New
→ Copy API key
```

**Bước 3: Thêm vào 9Router**

```bash
9router
# Dashboard → Providers → Add API Key

Provider: kimi
API Key: your-kimi-api-key
```

**Bước 4: Dùng trong CLI**

```
Model: kimi/kimi-latest
```

### Model có sẵn

| Model ID | Mô tả | Context | Tốt nhất cho |
|----------|-------------|---------|----------|
| `kimi/kimi-latest` | Kimi Latest | 200K | Coding chung |

### Mẹo Pro

- **Chi phí cố định** - $9/tháng bất kể usage (lên tới 10M)
- **Tốt nhất cho sử dụng đều** - Nếu dùng 10M/tháng, chỉ $0.90/1M
- **Reset hàng tháng** - 10M tokens reset hàng tháng
- **Billing dự đoán được** - Không có chi phí bất ngờ

### Reset Quota

```
Monthly reset: 1st of each month
→ 10M tokens refresh

Example monthly usage:
Week 1: 3M tokens
Week 2: 2M tokens
Week 3: 3M tokens
Week 4: 2M tokens
Total: 10M tokens = $9 flat
```

---

## So sánh Giá

| Provider | Input/1M | Output/1M | Reset | Chi phí 10M | Tốt nhất cho |
|----------|----------|-----------|-------|----------|----------|
| **GLM-4.7** | $0.60 | $2.20 | Hàng ngày 10AM | $6-22 | Dùng quota hàng ngày |
| **MiniMax M2.1** | $0.20 | $1.00 | 5 giờ | $2-10 | **Rẻ nhất!** |
| **Kimi K2** | $0.90 | $0.90 | Hàng tháng | **$9 cố định** | Sử dụng đều |
| ChatGPT API | $20.00 | $20.00 | Không | $200 | ❌ Đắt |

**Tiết kiệm:** Rẻ hơn ChatGPT API 90-95%!

---

## Ví dụ Sử dụng

### Setup Cursor IDE

```
Settings → Models → Advanced:
  OpenAI API Base URL: http://localhost:20128/v1
  OpenAI API Key: [from 9router dashboard]
  Model: glm/glm-4.7
```

### Tạo Combo (Khuyên dùng)

```
Dashboard → Combos → Create New

Name: cheap-backup
Models:
  1. cc/claude-opus-4-5 (Subscription primary)
  2. glm/glm-4.7 (Cheap backup, daily reset)
  3. minimax/MiniMax-M2.1 (Cheapest fallback)
  4. if/kimi-k2-thinking (FREE emergency)

Use in CLI: cheap-backup
```

**Kết quả:** Subscription → Cheap → Cheapest → Free

---

## Tối ưu Chi phí

### Chiến lược 1: Lịch Reset Hàng ngày

```
Morning (10AM): Fresh GLM quota
→ Use GLM for heavy tasks
→ Save subscription quota

Afternoon: Subscription quota
→ Use Claude/Codex for complex tasks

Evening: MiniMax (5h reset)
→ Cheap fallback for late work

Night: Free tier (iFlow)
→ Zero cost emergency backup
```

### Chiến lược 2: Ưu tiên Ngân sách

```
Set monthly budget: $20

Allocation:
- $9 Kimi K2 (10M tokens flat)
- $6 GLM daily quota (10M tokens)
- $5 MiniMax overflow (25M tokens)

Total: 45M tokens for $20
vs 1M tokens for $20 on ChatGPT API!
```

### Chiến lược 3: Tối đa Subscription Trước

```
Priority:
1. Gemini CLI (180K/month FREE)
2. Claude Code (subscription you already pay)
3. GLM-4.7 (cheap backup, $0.6/1M)
4. MiniMax M2.1 (cheapest, $0.2/1M)
5. iFlow (FREE emergency)

Monthly cost example (100M tokens):
- 60M via Gemini CLI: $0 (free)
- 30M via Claude Code: $0 (subscription)
- 8M via GLM: $4.80
- 2M via MiniMax: $0.40
Total: $5.20/month!
```

---

## Ví dụ Thực tế

### Ví dụ 1: Tháng Coding Nặng (100M tokens)

```
Breakdown:
- 60M via subscription (Claude/Codex): $0 extra
- 30M via GLM-4.7: $18
- 10M via MiniMax M2.1: $2

Total: $20/month
vs $2000 on ChatGPT API!

Savings: 99% cheaper!
```

### Ví dụ 2: Coder Ngân sách ($10/tháng)

```
Strategy:
- $9 Kimi K2 (10M tokens)
- $1 MiniMax overflow (5M tokens)

Total: 15M tokens for $10
vs 0.5M tokens for $10 on ChatGPT API!

30× more tokens!
```

### Ví dụ 3: Freelancer (Usage Biến thiên)

```
Light month (20M tokens):
- 15M via subscription: $0
- 5M via GLM: $3
Total: $3

Heavy month (150M tokens):
- 60M via subscription: $0
- 60M via GLM: $36
- 30M via MiniMax: $6
Total: $42

Average: $22.50/month
vs $3400 on ChatGPT API!
```

---

## Best Practices

### 1. Theo dõi Quota Hàng ngày

```
Dashboard shows:
- GLM quota: 75% used (reset in 6h)
- MiniMax quota: 50% used (reset in 2h)
- Kimi quota: 8M/10M used (reset in 15 days)

Plan heavy tasks around reset times!
```

### 2. Dùng Coding Plan (GLM)

```
Standard: 1× quota
Coding Plan: 3× quota (same price!)

→ Always choose Coding Plan
```

### 3. Kết hợp với Free Tier

```
Combo:
1. gc/gemini-3-flash (FREE primary)
2. glm/glm-4.7 (cheap backup)
3. minimax/MiniMax-M2.1 (cheapest)
4. if/kimi-k2-thinking (FREE emergency)

Result: Minimize costs, maximize uptime
```

### 4. Đặt Cảnh báo Ngân sách

```
Dashboard → Settings → Budget Alerts

Daily: $2 limit
Weekly: $10 limit
Monthly: $30 limit

→ Auto switch to free tier when limit reached
```

---

## Troubleshooting

### "Quota exhausted"

**Giải pháp:**
- GLM: Đợi đến 10:00 AM giờ Bắc Kinh
- MiniMax: Đợi 5 giờ kể từ lần dùng đầu
- Kimi: Đợi đến ngày 1 tháng sau
- Dùng combo fallback sang free tier

### "API key invalid"

**Giải pháp:**
- Kiểm tra API key sao chép đúng
- Xác minh tài khoản có credits
- Tạo lại API key nếu cần

### "High costs"

**Giải pháp:**
- Kiểm tra usage stats trong Dashboard
- Đặt cảnh báo ngân sách
- Chuyển sang MiniMax ($0.2/1M rẻ nhất)
- Dùng free tier cho task không quan trọng

---

## Bước tiếp theo

- **Thêm free fallback:** [Free Providers](./free.md)
- **Setup subscriptions:** [Subscription Providers](./subscription.md)
- **Tạo combos:** Dashboard → Combos → Create New
