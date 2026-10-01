# Troubleshooting

Common issues and solutions when using 9Router.

---

## "Language model did not provide messages"

**Problem:** Request fails with empty response or error message.

**Causes:**
- Provider quota exhausted
- API key invalid or expired
- Model not available

**Solutions:**

1. **Check quota status:**
   ```
   Dashboard → Providers → View quota tracker
   ```
   If quota is exhausted, wait for reset or switch provider.

2. **Use combo fallback:**
   ```
   Dashboard → Combos → Create fallback chain
   Example: cc/claude-opus → glm/glm-4.7 → if/kimi-k2
   ```

3. **Verify provider connection:**
   ```
   Dashboard → Providers → Reconnect if needed
   ```

---

## Rate Limiting

**Problem:** "Rate limit exceeded" or "Too many requests" errors.

**Causes:**
- Subscription quota depleted (5-hour/daily/weekly limits)
- API rate limits hit
- Too many concurrent requests

**Solutions:**

1. **Check reset time:**
   ```
   Dashboard → Quota Tracking → View reset countdown
   ```

2. **Switch to cheap tier:**
   ```
   Use: glm/glm-4.7 ($0.6/1M tokens)
        minimax/MiniMax-M2.1 ($0.20/1M tokens)
   ```

3. **Add fallback combo:**
   ```
   Dashboard → Combos → Add backup models
   Primary: cc/claude-opus (subscription)
   Backup: glm/glm-4.7 (cheap)
   Emergency: if/kimi-k2 (free)
   ```

---

## OAuth Token Expired

**Problem:** "Unauthorized" or "Token expired" errors.

**Causes:**
- OAuth token expired (auto-refresh failed)
- Provider session invalidated
- Network issues during refresh

**Solutions:**

1. **Auto-refresh (default):**
   9Router automatically refreshes tokens. Wait 30 seconds and retry.

2. **Manual reconnect:**
   ```
   Dashboard → Providers → [Provider Name] → Reconnect
   → Complete OAuth flow again
   ```

3. **Check provider status:**
   Verify provider service is online (Claude Code, Codex, etc.)

---

## High Costs

**Problem:** Unexpected high usage or costs.

**Causes:**
- Using expensive models unnecessarily
- No fallback to cheaper tiers
- Large context windows

**Solutions:**

1. **Check usage stats:**
   ```
   Dashboard → Usage Stats → View token consumption
   → Identify high-cost models
   ```

2. **Switch to cheaper models:**
   ```
   Replace: cc/claude-opus ($20-100/month subscription)
   With: glm/glm-4.7 ($0.6/1M tokens)
         minimax/MiniMax-M2.1 ($0.20/1M tokens)
   ```

3. **Use free tier:**
   ```
   if/kimi-k2-thinking (FREE)
   qw/qwen3-coder-plus (FREE)
   kr/claude-sonnet-4.5 (FREE)
   gc/gemini-3-flash-preview (FREE 180K/month)
   ```

4. **Optimize prompts:**
   - Reduce context size
   - Use streaming for long responses
   - Cache common prompts

---

## Connection Refused

**Problem:** "ECONNREFUSED" or "Cannot connect to localhost:20128".

**Causes:**
- 9Router not running
- Port 20128 blocked
- Firewall blocking connection

**Solutions:**

1. **Start 9Router:**
   ```bash
   9router
   ```
   Dashboard should open at http://localhost:3000

2. **Verify port 20128:**
   ```bash
   # Check if port is listening
   lsof -i :20128
   
   # Or on Windows
   netstat -ano | findstr :20128
   ```

3. **Check firewall:**
   - macOS: System Settings → Network → Firewall
   - Windows: Windows Defender Firewall → Allow app
   - Linux: `sudo ufw allow 20128`

4. **Use cloud endpoint:**
   If localhost doesn't work (e.g., Cursor IDE):
   ```
   Endpoint: https://9router.com/v1
   ```

---

## Dashboard Not Opening

**Problem:** Dashboard doesn't load at http://localhost:3000.

**Causes:**
- Port 3000 already in use
- 9Router crashed
- Browser cache issues

**Solutions:**

1. **Check if 9Router is running:**
   ```bash
   # Check process
   ps aux | grep 9router
   
   # Check port 3000
   lsof -i :3000
   ```

2. **Kill conflicting process:**
   ```bash
   # macOS/Linux
   lsof -ti:3000 | xargs kill -9
   
   # Windows
   netstat -ano | findstr :3000
   taskkill /PID <PID> /F
   ```

3. **Restart 9Router:**
   ```bash
   # Stop
   pkill -f 9router
   
   # Start
   9router
   ```

4. **Clear browser cache:**
   - Chrome: Ctrl+Shift+Delete → Clear cache
   - Try incognito mode

5. **Check firewall settings:**
   Ensure port 3000 is not blocked.

---

## Model Not Found

**Problem:** "Model not found" or "Invalid model" errors.

**Causes:**
- Provider not connected
- Model ID typo
- Provider inactive

**Solutions:**

1. **Verify provider connection:**
   ```
   Dashboard → Providers → Check status (green = active)
   ```

2. **Check model ID format:**
   ```
   Correct: cc/claude-opus-4-5-20251101
   Wrong: claude-opus-4-5-20251101
   
   Format: [provider-prefix]/[model-name]
   ```

3. **List available models:**
   ```bash
   curl http://localhost:20128/v1/models \
     -H "Authorization: Bearer your-api-key"
   ```

4. **Reconnect provider:**
   ```
   Dashboard → Providers → [Provider] → Reconnect
   ```

---

## Slow Response

**Problem:** Requests take too long or timeout.

**Causes:**
- Provider latency
- Network issues
- Large context/response
- Provider rate limiting

**Solutions:**

1. **Check provider status:**
   ```
   Dashboard → Providers → View latency stats
   ```

2. **Switch to faster model:**
   ```
   Fast: cc/claude-haiku-4-5 (Haiku is faster than Opus)
         gc/gemini-3-flash-preview
         qw/qwen3-coder-flash
   ```

3. **Use streaming:**
   ```json
   {
     "model": "cc/claude-opus-4-5",
     "messages": [...],
     "stream": true
   }
   ```

4. **Check network:**
   ```bash
   # Test latency
   ping api.anthropic.com
   ping api.openai.com
   ```

5. **Reduce context size:**
   - Trim message history
   - Use smaller prompts
   - Enable context pruning in CLI tool

---

## API Key Invalid

**Problem:** "Invalid API key" or "Authentication failed" errors.

**Causes:**
- Wrong API key copied
- API key expired
- API key not generated

**Solutions:**

1. **Regenerate API key:**
   ```
   Dashboard → Settings → API Keys → Generate New Key
   → Copy and use new key
   ```

2. **Verify key format:**
   ```
   Correct: 9r_xxxxxxxxxxxxxxxxxxxxxxxx
   Wrong: Missing 9r_ prefix
   ```

3. **Check key in CLI config:**
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

## Need More Help?

- **GitHub Issues:** [github.com/decolua/9router/issues](https://github.com/decolua/9router/issues)
- **Documentation:** [9router.com/docs](https://9router.com/docs)
- **FAQ:** [faq.md](faq.md)
