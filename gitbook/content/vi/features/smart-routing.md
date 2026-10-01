# Smart Routing & Auto Fallback

9Router tự động định tuyến request qua provider tốt nhất hiện có bằng hệ thống fallback 3 tầng. Không bao giờ ngừng code vì giới hạn quota hay rate limiting.

---

## Cách hoạt động

9Router dùng định tuyến thông minh để tối đa hóa subscription hiện có, giảm chi phí và đảm bảo khả dụng 24/7:

```
Request → 9Router → Check Tier 1 (Subscription)
                     ↓ quota exhausted
                     Check Tier 2 (Cheap)
                     ↓ budget limit
                     Check Tier 3 (Free)
                     ↓
                     Response
```

### Hệ thống Fallback 3 tầng

**Tier 1: SUBSCRIPTION (Chính)**
- Claude Code (Pro/Max)
- OpenAI Codex (Plus/Pro)
- Gemini CLI (MIỄN PHÍ 180K/tháng)
- GitHub Copilot
- Antigravity (Google)

**Mục tiêu**: Tối đa giá trị từ subscription đã trả tiền.

**Tier 2: CHEAP (Backup)**
- GLM-4.7 ($0.60/1M input)
- MiniMax M2.1 ($0.20/1M input)
- Kimi K2 ($9/tháng cố định)

**Mục tiêu**: Backup siêu rẻ khi hết quota subscription (~90% rẻ hơn ChatGPT API).

**Tier 3: FREE (Khẩn cấp)**
- iFlow (8 models)
- Qwen (3 models)
- Kiro (Claude MIỄN PHÍ)

**Mục tiêu**: Fallback chi phí 0 để code không giới hạn.

---

## Chuyển đổi Tự động

9Router giám sát quota thời gian thực và chuyển provider tự động:

### Kịch bản 1: Hết Quota Subscription

```
User request → cc/claude-opus-4-5
               ↓ quota exhausted (5-hour limit reached)
               Auto switch → glm/glm-4.7
               ↓ daily quota exhausted
               Auto switch → minimax/MiniMax-M2.1
               ↓ 5-hour quota exhausted
               Auto switch → if/kimi-k2-thinking (FREE)
               ↓
               Response delivered ✅
```

**Kết quả**: Zero downtime, trải nghiệm liền mạch.

### Kịch bản 2: Rate Limiting

```
User request → cx/gpt-5.2-codex
               ↓ rate limited (too many requests)
               Auto switch → glm/glm-4.7
               ↓
               Response delivered ✅
```

### Kịch bản 3: Provider không khả dụng

```
User request → cc/claude-opus-4-5
               ↓ provider error (503)
               Auto switch → next available model
               ↓
               Response delivered ✅
```

---

## Logic chọn Model

9Router chọn model tốt nhất dựa trên:

1. **Khả dụng quota** - Kiểm tra provider còn quota không
2. **Tier chi phí** - Ưu tiên subscription → cheap → free
3. **Thời gian reset** - Cân nhắc khi quota reset
4. **Sức khỏe provider** - Bỏ qua provider có lỗi

### Ví dụ Thứ tự Ưu tiên

Cho request đến `cc/claude-opus-4-5`:

```
1. Check Claude Code quota
   ✅ Available → Use cc/claude-opus-4-5
   ❌ Exhausted → Continue to step 2

2. Check fallback tier (if configured)
   ✅ GLM quota available → Use glm/glm-4.7
   ❌ Exhausted → Continue to step 3

3. Check free tier
   ✅ iFlow available → Use if/kimi-k2-thinking
   ❌ All exhausted → Return quota error
```

---

## Tùy chọn Cấu hình

### Cài đặt Dashboard

**1. Bật/Tắt Auto Fallback**

```
Dashboard → Settings → Smart Routing
→ Toggle "Auto Fallback" ON/OFF
```

- **ON** (mặc định): Chuyển tier tự động
- **OFF**: Strict mode, trả lỗi nếu model chính không khả dụng

**2. Đặt Giới hạn Ngân sách**

```
Dashboard → Settings → Budget Control
→ Daily limit: $5
→ Monthly limit: $50
```

Khi đạt ngân sách, 9Router tự động chuyển sang free tier.

**3. Cấu hình Thứ tự Fallback**

```
Dashboard → Settings → Fallback Priority
→ Drag to reorder providers within each tier
```

Ví dụ thứ tự tùy chỉnh:
```
Tier 1: Gemini CLI → Claude Code → Codex
Tier 2: MiniMax → GLM → Kimi
Tier 3: iFlow → Kiro → Qwen
```

**4. Thông báo Reset Quota**

```
Dashboard → Settings → Notifications
→ Email when quota resets
→ Alert when 80% quota used
```

---

## Ví dụ

### Ví dụ 1: Auto Fallback Cơ bản

**Setup:**
```
Model: cc/claude-opus-4-5-20251101
Fallback: Auto (default 3-tier)
```

**Hoạt động:**
```
Morning (fresh quota):
  Request → cc/claude-opus-4-5 ✅

Afternoon (quota exhausted):
  Request → glm/glm-4.7 ✅ (auto switched)

Evening (GLM quota out):
  Request → minimax/MiniMax-M2.1 ✅ (auto switched)

Late night (all paid quota out):
  Request → if/kimi-k2-thinking ✅ (free tier)
```

**Chi phí**: ~$5-10/tháng extra (chủ yếu được bao bởi subscription).

### Ví dụ 2: Định tuyến theo Ngân sách

**Setup:**
```
Dashboard → Settings:
  Daily budget: $2
  Monthly budget: $20
  Fallback: Enabled
```

**Hoạt động:**
```
Day 1-15 (within budget):
  Requests → glm/glm-4.7 (cheap tier)
  Cost: $1.50/day

Day 16 (budget reached):
  Requests → if/kimi-k2-thinking (free tier)
  Cost: $0

Next month (budget resets):
  Requests → glm/glm-4.7 again
```

**Kết quả**: Không bao giờ vượt $20/tháng, luôn khả dụng.

### Ví dụ 3: Chế độ Chỉ Subscription

**Setup:**
```
Dashboard → Settings:
  Auto Fallback: OFF
  Strict mode: ON
```

**Hoạt động:**
```
Request → cc/claude-opus-4-5
  ✅ Quota available → Success
  ❌ Quota exhausted → Return error (no fallback)
```

**Use case**: Khi chỉ muốn dùng subscription trả phí, không phí thêm.

### Ví dụ 4: Chế độ Chỉ Free

**Setup:**
```
Model: if/kimi-k2-thinking
Fallback: qw/qwen3-coder-plus → kr/claude-sonnet-4.5
```

**Hoạt động:**
```
All requests → Free tier only
Cost: $0 forever
```

**Use case**: Dự án cá nhân, học tập, thử nghiệm.

---

## Best Practices

### 1. Tối đa Giá trị Subscription

```
Strategy:
- Set subscription models as Tier 1
- Monitor quota usage in dashboard
- Use cheap tier only when subscription exhausted
```

**Ví dụ combo:**
```
cc/claude-opus-4-5 → glm/glm-4.7 → if/kimi-k2-thinking
```

### 2. Tối ưu Chi phí

```
Strategy:
- Use Gemini CLI free tier first (180K/month)
- Fallback to GLM/MiniMax (ultra-cheap)
- Emergency: iFlow (free)
```

**Ví dụ combo:**
```
gc/gemini-3-flash-preview → glm/glm-4.7 → if/kimi-k2-thinking
```

### 3. Tối ưu Chất lượng

```
Strategy:
- Use best models (Claude Opus, GPT-5.2)
- Fallback to good cheap models (GLM-4.7)
- Last resort: Free tier
```

**Ví dụ combo:**
```
cc/claude-opus-4-5 → cx/gpt-5.2-codex → glm/glm-4.7
```

### 4. Khả dụng 24/7

```
Strategy:
- Always include free tier in fallback
- Monitor quota reset times
- Distribute usage across providers
```

**Ví dụ combo:**
```
cc/claude-opus-4-5 → glm/glm-4.7 → minimax/MiniMax-M2.1 → if/kimi-k2-thinking
```

**Kết quả**: Không bao giờ hết quota, code mọi lúc.

---

## Chiến lược Reset Quota

Lên kế hoạch usage quanh thời gian reset quota:

| Provider | Quota Reset | Chiến lược |
|----------|-------------|----------|
| **Claude Code** | 5 giờ + hàng tuần | Dùng buổi sáng, quota mới |
| **Codex** | 5 giờ + hàng tuần | Dùng sau khi hết quota Claude |
| **Gemini CLI** | Hàng ngày (1K) + Hàng tháng (180K) | Dùng cả ngày |
| **GLM-4.7** | Hàng ngày 10:00 AM | Dùng buổi tối, reset sáng hôm sau |
| **MiniMax M2.1** | 5 giờ rolling | Dùng mọi lúc, theo rolling window |
| **iFlow/Qwen/Kiro** | Không giới hạn | Backup khẩn cấp |

**Ví dụ lịch hàng ngày:**
```
08:00 - 13:00: Claude Code (fresh 5h quota)
13:00 - 18:00: Gemini CLI (1K/day quota)
18:00 - 22:00: GLM-4.7 (cheap, resets 10AM)
22:00 - 08:00: MiniMax or iFlow (5h rolling or free)
```

---

## Giám sát & Cảnh báo

### Dashboard Quota Tracker

```
Dashboard → Quota Overview:
  Claude Code: 2.5h / 5h remaining (50%)
  Gemini CLI: 450 / 1000 requests today
  GLM-4.7: 5M / 10M tokens (resets in 8h)
  MiniMax: 3M / 5M tokens (rolling 5h)
```

### Thông báo Thời gian thực

```
Dashboard → Notifications:
  ⚠️ Claude Code quota 80% used (1h remaining)
  ✅ GLM-4.7 quota reset (10M tokens available)
  💰 Daily budget 50% used ($2.50 / $5)
```

### Usage Analytics

```
Dashboard → Analytics:
  Today: 50M tokens
    - 30M via Claude Code (subscription)
    - 15M via GLM-4.7 ($9)
    - 5M via iFlow (free)
  
  Cost: $9 (vs $1000 on ChatGPT API)
  Savings: 99%
```

---

## Troubleshooting

**Issue: "All providers quota exhausted"**

**Giải pháp:**
1. Kiểm tra quota tracker trong dashboard
2. Đợi quota reset (xem countdown)
3. Thêm free tier vào fallback chain
4. Hoặc tăng giới hạn ngân sách

**Issue: "Too many fallback switches"**

**Giải pháp:**
1. Kiểm tra provider chính có down không
2. Tăng giới hạn quota (upgrade subscription)
3. Dùng model chính rẻ hơn (GLM thay vì Claude)

**Issue: "Unexpected costs"**

**Giải pháp:**
1. Dashboard → Analytics → Xem usage
2. Đặt giới hạn ngân sách hàng ngày/tháng
3. Chuyển sang free tier cho task không quan trọng
4. Dùng combo với free fallback

---

## Liên quan

- [Combos](./combos.md) - Tạo chuỗi fallback tùy chỉnh
- [Quota Tracking](./quota-tracking.md) - Theo dõi usage và chi phí
