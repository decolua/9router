# Combos - Chuỗi Fallback Tùy chỉnh

Tạo các tổ hợp model tùy chỉnh với fallback tự động. Combo cho phép bạn định nghĩa chiến lược routing dựa trên chi phí, chất lượng và tính khả dụng.

---

## Combos là gì?

Combos là **chuỗi fallback tùy chỉnh** bạn tạo trong dashboard. Thay vì dùng một model duy nhất, bạn định nghĩa một chuỗi các model mà 9Router sẽ thử theo thứ tự.

**Ví dụ:**
```
Combo name: premium-coding
Models:
  1. cc/claude-opus-4-5-20251101 (try first)
  2. glm/glm-4.7 (if #1 quota exhausted)
  3. minimax/MiniMax-M2.1 (if #2 quota exhausted)
```

**Dùng trong CLI:**
```
Model: premium-coding
```

9Router tự động thử từng model theo thứ tự cho đến khi thành công.

---

## Tại sao dùng Combos?

### 1. Tối đa hóa Giá trị Subscription
```
cc/claude-opus → glm/glm-4.7 → if/kimi-k2-thinking

→ Use subscription first, cheap backup, free emergency
→ Get full value from subscriptions you already pay for
```

### 2. Giảm Chi phí
```
glm/glm-4.7 → minimax/MiniMax-M2.1 → if/kimi-k2-thinking

→ Start with cheapest paid option ($0.60/1M)
→ Fallback to even cheaper ($0.20/1M)
→ Emergency free tier
→ Total cost: ~$5-10/month vs $2000 on ChatGPT API
```

### 3. Đảm bảo Khả dụng 24/7
```
cc/claude-opus → cx/gpt-5.2-codex → glm/glm-4.7 → if/kimi-k2-thinking

→ Always include free tier at the end
→ Never run out of quota
→ Code anytime, anywhere
```

### 4. Tối ưu Chất lượng
```
cc/claude-opus-4-5 → cx/gpt-5.2-codex → gc/gemini-3-pro

→ Best models first
→ Fallback to other premium models
→ Maintain high quality across fallback chain
```

---

## Cách tạo Combos

### Bước 1: Mở Dashboard

```
http://localhost:20128
→ Login with your password
```

### Bước 2: Đi đến Combos

```
Dashboard → Combos → Create New Combo
```

### Bước 3: Cấu hình Combo

**Tên Combo:**
```
premium-coding
```

**Mô tả (tùy chọn):**
```
Subscription first, cheap backup, free emergency
```

**Chọn Models:**
```
1. cc/claude-opus-4-5-20251101
2. glm/glm-4.7
3. minimax/MiniMax-M2.1
```

**Kéo để sắp xếp lại** - Ưu tiên từ trên xuống dưới.

### Bước 4: Lưu

```
Click "Save Combo"
→ Combo appears in model list
```

### Bước 5: Dùng trong CLI

```
Cursor/Cline/Any tool:
  Model: premium-coding
```

---

## Ví dụ Combos

### Ví dụ 1: Premium Coding (Subscription → Cheap → Free)

**Mục tiêu**: Tối đa giá trị subscription, giảm chi phí thêm.

```
Dashboard → Combos → Create New

Name: premium-coding
Models:
  1. cc/claude-opus-4-5-20251101
  2. glm/glm-4.7
  3. minimax/MiniMax-M2.1
```

**Sử dụng:**
```
Cursor IDE:
  Model: premium-coding
```

**Hoạt động:**
```
Morning (fresh quota):
  Request → cc/claude-opus-4-5 ✅

Afternoon (Claude quota out):
  Request → glm/glm-4.7 ✅ (auto switched)

Evening (GLM quota out):
  Request → minimax/MiniMax-M2.1 ✅ (auto switched)
```

**Chi phí hàng tháng (100M tokens):**
```
80M via Claude Code: $0 (subscription)
15M via GLM: $9
5M via MiniMax: $1
Total: $10 + your subscription
```

**Tiết kiệm**: ~99% so với ChatGPT API ($2000).

---

### Ví dụ 2: Budget Combo (Cheap → Free)

**Mục tiêu**: Giảm chi phí, dùng free tier làm backup.

```
Dashboard → Combos → Create New

Name: budget-combo
Models:
  1. glm/glm-4.7
  2. minimax/MiniMax-M2.1
  3. if/kimi-k2-thinking
```

**Sử dụng:**
```
Cline:
  Provider: OpenAI Compatible
  Base URL: http://localhost:20128/v1
  Model: budget-combo
```

**Hoạt động:**
```
Request → glm/glm-4.7
  ✅ Daily quota available → Use GLM ($0.60/1M)
  ❌ Quota exhausted → Try MiniMax ($0.20/1M)
  ❌ MiniMax quota out → Use iFlow (FREE)
```

**Chi phí hàng tháng (100M tokens):**
```
70M via GLM: $42
20M via MiniMax: $4
10M via iFlow: $0
Total: $46 vs $2000 on ChatGPT API
```

**Tiết kiệm**: 97%.

---

### Ví dụ 3: Free Combo (Chi phí 0)

**Mục tiêu**: 100% miễn phí, không bao giờ tốn tiền.

```
Dashboard → Combos → Create New

Name: free-combo
Models:
  1. if/kimi-k2-thinking
  2. qw/qwen3-coder-plus
  3. kr/claude-sonnet-4.5
```

**Sử dụng:**
```
Claude Desktop:
  Model: free-combo
```

**Hoạt động:**
```
Request → if/kimi-k2-thinking
  ✅ Available → Use iFlow
  ❌ Error → Try Qwen
  ❌ Error → Try Kiro
```

**Chi phí hàng tháng:**
```
100M tokens via free providers: $0
Total: $0 forever
```

**Use case**: Dự án cá nhân, học tập, thử nghiệm.

---

### Ví dụ 4: Quality First (Chỉ Premium Models)

**Mục tiêu**: Chất lượng tốt nhất, không fallback rẻ.

```
Dashboard → Combos → Create New

Name: quality-first
Models:
  1. cc/claude-opus-4-5-20251101
  2. cx/gpt-5.2-codex
  3. gc/gemini-3-pro-preview
```

**Sử dụng:**
```
Codex CLI:
  export OPENAI_BASE_URL="http://localhost:20128"
  Model: quality-first
```

**Hoạt động:**
```
Request → cc/claude-opus-4-5
  ❌ Quota out → cx/gpt-5.2-codex
  ❌ Quota out → gc/gemini-3-pro-preview
  ❌ All out → Return error (no cheap fallback)
```

**Use case**: Code production quan trọng, refactoring phức tạp.

---

### Ví dụ 5: Multi-Subscription (Tối đa hết tất cả)

**Mục tiêu**: Dùng hết subscription trước khi trả thêm tiền.

```
Dashboard → Combos → Create New

Name: multi-sub
Models:
  1. gc/gemini-3-flash-preview (FREE 180K/month)
  2. cc/claude-opus-4-5-20251101 (Pro subscription)
  3. cx/gpt-5.2-codex (Plus subscription)
  4. gh/gpt-5 (Copilot subscription)
  5. glm/glm-4.7 (Cheap backup)
  6. if/kimi-k2-thinking (Free emergency)
```

**Chi phí hàng tháng (200M tokens):**
```
50M via Gemini CLI: $0 (free tier)
80M via Claude Code: $0 (subscription)
40M via Codex: $0 (subscription)
20M via Copilot: $0 (subscription)
8M via GLM: $4.80
2M via iFlow: $0
Total: $4.80 + existing subscriptions
```

**Kết quả**: Dùng 190M tokens từ subscription, chỉ $4.80 phụ.

---

### Ví dụ 6: Tối ưu Reset Quota

**Mục tiêu**: Phân bổ sử dụng dựa trên thời gian reset.

```
Dashboard → Combos → Create New

Name: reset-optimized
Models:
  1. cc/claude-opus-4-5 (5h reset, use morning)
  2. gc/gemini-3-flash (1K/day, use afternoon)
  3. glm/glm-4.7 (daily 10AM reset, use evening)
  4. minimax/MiniMax-M2.1 (5h rolling, use night)
  5. if/kimi-k2-thinking (unlimited, emergency)
```

**Lịch trình hàng ngày:**
```
08:00 - 13:00: Claude Code (fresh 5h quota)
13:00 - 18:00: Gemini CLI (1K/day quota)
18:00 - 22:00: GLM (resets 10AM next day)
22:00 - 08:00: MiniMax (5h rolling) or iFlow
```

**Kết quả**: Code 24/7 với chi phí tối thiểu.

---

## Dùng Combos trong CLI Tools

### Cursor IDE

```
Settings → Models → Advanced:
  OpenAI API Base URL: http://localhost:20128/v1
  OpenAI API Key: [from dashboard]
  Model: premium-coding
```

### Claude Desktop

Sửa `~/.claude/config.json`:
```json
{
  "anthropic_api_base": "http://localhost:20128/v1",
  "anthropic_api_key": "your-9router-api-key",
  "model": "budget-combo"
}
```

### Codex CLI

```bash
export OPENAI_BASE_URL="http://localhost:20128"
export OPENAI_API_KEY="your-9router-api-key"

codex --model quality-first "your prompt"
```

### Cline / Continue / RooCode

```
Provider: OpenAI Compatible
Base URL: http://localhost:20128/v1
API Key: [from dashboard]
Model: free-combo
```

### API Request

```bash
curl http://localhost:20128/v1/chat/completions \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "premium-coding",
    "messages": [
      {"role": "user", "content": "Write a function to..."}
    ],
    "stream": true
  }'
```

---

## Best Practices

### 1. Luôn bao gồm Free Tier

```
✅ Good:
cc/claude-opus → glm/glm-4.7 → if/kimi-k2-thinking

❌ Bad:
cc/claude-opus → glm/glm-4.7
(no free fallback, can run out of quota)
```

**Lý do**: Đảm bảo khả dụng 24/7, không bao giờ bị chặn bởi quota.

### 2. Sắp xếp theo Chi phí (Rẻ đến Đắt)

```
✅ Good:
glm/glm-4.7 → minimax/MiniMax-M2.1 → cc/claude-opus

❌ Bad:
cc/claude-opus → glm/glm-4.7
(wastes subscription quota on simple tasks)
```

**Ngoại lệ**: Nếu muốn tối đa giá trị subscription, đặt subscription đầu tiên.

### 3. Phù hợp với Yêu cầu Chất lượng

```
For production code:
cc/claude-opus → cx/gpt-5.2-codex → glm/glm-4.7

For quick tasks:
glm/glm-4.7 → if/kimi-k2-thinking

For experimentation:
if/kimi-k2-thinking → qw/qwen3-coder-plus
```

### 4. Cân nhắc Thời gian Reset Quota

```
Morning combo (fresh quotas):
cc/claude-opus → cx/gpt-5.2-codex

Evening combo (quotas likely exhausted):
glm/glm-4.7 → minimax/MiniMax-M2.1 → if/kimi-k2-thinking
```

### 5. Tạo nhiều Combo cho các Use Case khác nhau

```
premium-coding: For complex tasks
budget-combo: For simple tasks
free-combo: For experimentation
quality-first: For production code
```

**Chuyển đổi combo** dựa trên yêu cầu task.

### 6. Theo dõi hiệu năng Combo

```
Dashboard → Analytics → Combo Usage:
  premium-coding:
    80% via cc/claude-opus (good, using subscription)
    15% via glm/glm-4.7 (acceptable backup)
    5% via minimax (rare fallback)
```

**Tối ưu**: Nếu fallback quá nhiều, tăng quota chính hoặc sắp xếp lại model.

---

## Cấu hình Nâng cao

### Đặt Giới hạn Ngân sách cho mỗi Combo

```
Dashboard → Combos → Edit → Budget:
  Daily limit: $5
  Monthly limit: $50
```

Khi đạt giới hạn, 9Router bỏ qua model trả phí và chỉ dùng free tier.

### Bật/Tắt Model trong Combo

```
Dashboard → Combos → Edit → Models:
  ✅ cc/claude-opus-4-5 (enabled)
  ❌ glm/glm-4.7 (temporarily disabled)
  ✅ if/kimi-k2-thinking (enabled)
```

**Use case**: Tạm tắt model đắt mà không cần xóa combo.

### Clone Combo có sẵn

```
Dashboard → Combos → Clone "premium-coding"
→ Creates copy with "-copy" suffix
→ Modify and save as new combo
```

**Use case**: Tạo biến thể cho các kịch bản khác nhau.

---

## Troubleshooting

**Issue: Combo không xuất hiện trong danh sách model**

**Giải pháp:**
1. Refresh dashboard
2. Kiểm tra combo đã được lưu (dấu tick xanh)
3. Khởi động lại CLI tool để refresh danh sách model

**Issue: Combo luôn dùng model cuối cùng (free tier)**

**Giải pháp:**
1. Kiểm tra quota cho các model chính (Dashboard → Quota)
2. Xác minh API keys hợp lệ (Dashboard → Providers)
3. Kiểm tra giới hạn ngân sách không vượt quá

**Issue: Combo tốn hơn dự kiến**

**Giải pháp:**
1. Dashboard → Analytics → Xem usage combo
2. Kiểm tra model chính có bị hết quota không
3. Sắp xếp lại model (đặt rẻ hơn lên trước)
4. Đặt giới hạn ngân sách

---

## Liên quan

- [Smart Routing](./smart-routing.md) - Cách auto fallback hoạt động
- [Quota Tracking](./quota-tracking.md) - Theo dõi sử dụng và chi phí
