# Troubleshooting

Các vấn đề và giải pháp phổ biến khi dùng 9Router.

---

## "Language model did not provide messages"

**Vấn đề:** Request thất bại với phản hồi rỗng hoặc thông báo lỗi.

**Nguyên nhân:**
- Hết quota provider
- API key không hợp lệ hoặc hết hạn
- Model không khả dụng

**Giải pháp:**

1. **Kiểm tra trạng thái quota:**
   ```
   Dashboard → Providers → View quota tracker
   ```
   Nếu hết quota, đợi reset hoặc đổi provider.

2. **Dùng fallback combo:**
   ```
   Dashboard → Combos → Create fallback chain
   Example: cc/claude-opus → glm/glm-4.7 → if/kimi-k2
   ```

3. **Xác minh kết nối provider:**
   ```
   Dashboard → Providers → Reconnect if needed
   ```

---

## Rate Limiting

**Vấn đề:** Lỗi "Rate limit exceeded" hoặc "Too many requests".

**Nguyên nhân:**
- Hết quota subscription (giới hạn 5h/ngày/tuần)
- Đạt API rate limit
- Quá nhiều request đồng thời

**Giải pháp:**

1. **Kiểm tra thời gian reset:**
   ```
   Dashboard → Quota Tracking → View reset countdown
   ```

2. **Chuyển sang tier rẻ:**
   ```
   Use: glm/glm-4.7 ($0.6/1M tokens)
        minimax/MiniMax-M2.1 ($0.20/1M tokens)
   ```

3. **Thêm fallback combo:**
   ```
   Dashboard → Combos → Add backup models
   Primary: cc/claude-opus (subscription)
   Backup: glm/glm-4.7 (cheap)
   Emergency: if/kimi-k2 (free)
   ```

---

## OAuth Token hết hạn

**Vấn đề:** Lỗi "Unauthorized" hoặc "Token expired".

**Nguyên nhân:**
- OAuth token hết hạn (auto-refresh thất bại)
- Session provider không hợp lệ
- Vấn đề network khi refresh

**Giải pháp:**

1. **Auto-refresh (mặc định):**
   9Router tự refresh tokens. Đợi 30 giây rồi thử lại.

2. **Kết nối lại thủ công:**
   ```
   Dashboard → Providers → [Provider Name] → Reconnect
   → Complete OAuth flow again
   ```

3. **Kiểm tra trạng thái provider:**
   Xác minh provider service đang online (Claude Code, Codex, v.v.)

---

## Chi phí cao

**Vấn đề:** Sử dụng hoặc chi phí cao bất ngờ.

**Nguyên nhân:**
- Dùng model đắt không cần thiết
- Không fallback sang tier rẻ hơn
- Context window lớn

**Giải pháp:**

1. **Kiểm tra usage stats:**
   ```
   Dashboard → Usage Stats → View token consumption
   → Identify high-cost models
   ```

2. **Chuyển sang model rẻ hơn:**
   ```
   Replace: cc/claude-opus ($20-100/month subscription)
   With: glm/glm-4.7 ($0.6/1M tokens)
         minimax/MiniMax-M2.1 ($0.20/1M tokens)
   ```

3. **Dùng free tier:**
   ```
   if/kimi-k2-thinking (FREE)
   qw/qwen3-coder-plus (FREE)
   kr/claude-sonnet-4.5 (FREE)
   gc/gemini-3-flash-preview (FREE 180K/month)
   ```

4. **Tối ưu prompt:**
   - Giảm context size
   - Dùng streaming cho phản hồi dài
   - Cache prompt thường dùng

---

## Connection Refused

**Vấn đề:** Lỗi "ECONNREFUSED" hoặc "Cannot connect to localhost:20128".

**Nguyên nhân:**
- 9Router không chạy
- Port 20128 bị chặn
- Firewall chặn kết nối

**Giải pháp:**

1. **Khởi động 9Router:**
   ```bash
   9router
   ```
   Dashboard sẽ mở tại http://localhost:3000

2. **Xác minh port 20128:**
   ```bash
   # Check if port is listening
   lsof -i :20128
   
   # Or on Windows
   netstat -ano | findstr :20128
   ```

3. **Kiểm tra firewall:**
   - macOS: System Settings → Network → Firewall
   - Windows: Windows Defender Firewall → Allow app
   - Linux: `sudo ufw allow 20128`

4. **Dùng cloud endpoint:**
   Nếu localhost không hoạt động (ví dụ: Cursor IDE):
   ```
   Endpoint: https://9router.com/v1
   ```

---

## Dashboard không mở

**Vấn đề:** Dashboard không load tại http://localhost:3000.

**Nguyên nhân:**
- Port 3000 đã được dùng
- 9Router bị crash
- Vấn đề cache browser

**Giải pháp:**

1. **Kiểm tra 9Router có chạy không:**
   ```bash
   # Check process
   ps aux | grep 9router
   
   # Check port 3000
   lsof -i :3000
   ```

2. **Kill process xung đột:**
   ```bash
   # macOS/Linux
   lsof -ti:3000 | xargs kill -9
   
   # Windows
   netstat -ano | findstr :3000
   taskkill /PID <PID> /F
   ```

3. **Khởi động lại 9Router:**
   ```bash
   # Stop
   pkill -f 9router
   
   # Start
   9router
   ```

4. **Xóa cache browser:**
   - Chrome: Ctrl+Shift+Delete → Clear cache
   - Thử chế độ ẩn danh

5. **Kiểm tra cài đặt firewall:**
   Đảm bảo port 3000 không bị chặn.

---

## Model Not Found

**Vấn đề:** Lỗi "Model not found" hoặc "Invalid model".

**Nguyên nhân:**
- Provider chưa kết nối
- Sai chính tả model ID
- Provider không hoạt động

**Giải pháp:**

1. **Xác minh kết nối provider:**
   ```
   Dashboard → Providers → Check status (green = active)
   ```

2. **Kiểm tra format model ID:**
   ```
   Correct: cc/claude-opus-4-5-20251101
   Wrong: claude-opus-4-5-20251101
   
   Format: [provider-prefix]/[model-name]
   ```

3. **Liệt kê model khả dụng:**
   ```bash
   curl http://localhost:20128/v1/models \
     -H "Authorization: Bearer your-api-key"
   ```

4. **Kết nối lại provider:**
   ```
   Dashboard → Providers → [Provider] → Reconnect
   ```

---

## Phản hồi chậm

**Vấn đề:** Request mất quá lâu hoặc timeout.

**Nguyên nhân:**
- Độ trễ provider
- Vấn đề network
- Context/response lớn
- Provider rate limiting

**Giải pháp:**

1. **Kiểm tra trạng thái provider:**
   ```
   Dashboard → Providers → View latency stats
   ```

2. **Chuyển sang model nhanh hơn:**
   ```
   Fast: cc/claude-haiku-4-5 (Haiku is faster than Opus)
         gc/gemini-3-flash-preview
         qw/qwen3-coder-flash
   ```

3. **Dùng streaming:**
   ```json
   {
     "model": "cc/claude-opus-4-5",
     "messages": [...],
     "stream": true
   }
   ```

4. **Kiểm tra network:**
   ```bash
   # Test latency
   ping api.anthropic.com
   ping api.openai.com
   ```

5. **Giảm context size:**
   - Cắt bớt lịch sử tin nhắn
   - Dùng prompt nhỏ hơn
   - Bật context pruning trong CLI tool

---

## API Key không hợp lệ

**Vấn đề:** Lỗi "Invalid API key" hoặc "Authentication failed".

**Nguyên nhân:**
- Sao chép sai API key
- API key hết hạn
- API key chưa được tạo

**Giải pháp:**

1. **Tạo lại API key:**
   ```
   Dashboard → Settings → API Keys → Generate New Key
   → Copy and use new key
   ```

2. **Xác minh format key:**
   ```
   Correct: 9r_xxxxxxxxxxxxxxxxxxxxxxxx
   Wrong: Missing 9r_ prefix
   ```

3. **Kiểm tra key trong CLI config:**
   ```bash
   # Cursor
   Settings → Models → OpenAI API Key
   
   # Cline
   Settings → API Key
   
   # Environment variable
   export OPENAI_API_KEY="9r_your_key"
   ```

4. **Test API key:**
   ```bash
   curl http://localhost:20128/v1/models \
     -H "Authorization: Bearer 9r_your_key"
   ```

---

## Cần trợ giúp thêm?

- **GitHub Issues:** [github.com/decolua/9router/issues](https://github.com/decolua/9router/issues)
- **Documentation:** [9router.com/docs](https://9router.com/docs)
- **FAQ:** [faq.md](faq.md)
