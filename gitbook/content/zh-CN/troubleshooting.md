# 故障排除

使用 9Router 时常见的问题与解决方案。

---

## "Language model did not provide messages"

**问题:** 请求失败,响应为空或返回错误。

**原因:**
- 提供商配额耗尽
- API key 无效或过期
- 模型不可用

**解决方案:**

1. **查看配额状态:**
   ```
   仪表盘 → 提供商 → 查看配额跟踪
   ```
   若配额耗尽,等待重置或切换提供商。

2. **使用组合回退:**
   ```
   仪表盘 → 组合 → 创建回退链
   示例: cc/claude-opus → glm/glm-4.7 → if/kimi-k2
   ```

3. **验证提供商连接:**
   ```
   仪表盘 → 提供商 → 必要时重新连接
   ```

---

## 速率限制

**问题:** 出现 "Rate limit exceeded" 或 "Too many requests" 错误。

**原因:**
- 订阅配额用完(5 小时/每日/每周限制)
- 触发了 API 速率限制
- 并发请求过多

**解决方案:**

1. **查看重置时间:**
   ```
   仪表盘 → 配额跟踪 → 查看重置倒计时
   ```

2. **切换到低价层:**
   ```
   使用: glm/glm-4.7 (每 1M tokens $0.6)
        minimax/MiniMax-M2.1 (每 1M tokens $0.20)
   ```

3. **添加回退组合:**
   ```
   仪表盘 → 组合 → 添加备用模型
   主力: cc/claude-opus (订阅)
   备用: glm/glm-4.7 (低价)
   应急: if/kimi-k2 (免费)
   ```

---

## OAuth Token 过期

**问题:** 出现 "Unauthorized" 或 "Token expired" 错误。

**原因:**
- OAuth token 过期(自动刷新失败)
- 提供商会话失效
- 刷新过程中出现网络问题

**解决方案:**

1. **自动刷新(默认):**
   9Router 会自动刷新 token。等待 30 秒后重试。

2. **手动重连:**
   ```
   仪表盘 → 提供商 → [提供商名称] → 重新连接
   → 再次完成 OAuth 流程
   ```

3. **检查提供商状态:**
   确认提供商服务在线(Claude Code、Codex 等)。

---

## 成本过高

**问题:** 出现意外的高用量或高成本。

**原因:**
- 不必要地使用了昂贵模型
- 没有回退到便宜层级
- 上下文窗口过大

**解决方案:**

1. **查看使用统计:**
   ```
   仪表盘 → 使用统计 → 查看 token 消耗
   → 找出高成本模型
   ```

2. **切换到更便宜的模型:**
   ```
   替换: cc/claude-opus ($20-100/月 订阅)
   为: glm/glm-4.7 (每 1M tokens $0.6)
       minimax/MiniMax-M2.1 (每 1M tokens $0.20)
   ```

3. **使用免费层:**
   ```
   if/kimi-k2-thinking (免费)
   qw/qwen3-coder-plus (免费)
   kr/claude-sonnet-4.5 (免费)
   gc/gemini-3-flash-preview (每月免费 180K)
   ```

4. **优化 prompt:**
   - 减少上下文大小
   - 长响应使用流式输出
   - 缓存常用 prompt

---

## 连接被拒绝

**问题:** 出现 "ECONNREFUSED" 或 "Cannot connect to localhost:20128"。

**原因:**
- 9Router 未运行
- 端口 20128 被阻止
- 防火墙拦截连接

**解决方案:**

1. **启动 9Router:**
   ```bash
   9router
   ```
   仪表盘应该在 http://localhost:3000 打开。

2. **检查端口 20128:**
   ```bash
   # 检查端口是否监听
   lsof -i :20128
   
   # Windows
   netstat -ano | findstr :20128
   ```

3. **检查防火墙:**
   - macOS: 系统设置 → 网络 → 防火墙
   - Windows: Windows Defender 防火墙 → 允许应用
   - Linux: `sudo ufw allow 20128`

4. **使用云端 endpoint:**
   如果 localhost 不行(例如 Cursor IDE):
   ```
   Endpoint: https://9router.com/v1
   ```

---

## 仪表盘无法打开

**问题:** 仪表盘无法在 http://localhost:3000 加载。

**原因:**
- 端口 3000 被占用
- 9Router 崩溃
- 浏览器缓存问题

**解决方案:**

1. **确认 9Router 是否运行:**
   ```bash
   # 检查进程
   ps aux | grep 9router
   
   # 检查端口 3000
   lsof -i :3000
   ```

2. **杀掉冲突进程:**
   ```bash
   # macOS/Linux
   lsof -ti:3000 | xargs kill -9
   
   # Windows
   netstat -ano | findstr :3000
   taskkill /PID <PID> /F
   ```

3. **重启 9Router:**
   ```bash
   # 停止
   pkill -f 9router
   
   # 启动
   9router
   ```

4. **清除浏览器缓存:**
   - Chrome: Ctrl+Shift+Delete → 清除缓存
   - 尝试无痕模式

5. **检查防火墙设置:**
   确认端口 3000 未被阻止。

---

## 模型未找到

**问题:** 出现 "Model not found" 或 "Invalid model" 错误。

**原因:**
- 提供商未连接
- 模型 ID 拼写错误
- 提供商未激活

**解决方案:**

1. **验证提供商连接:**
   ```
   仪表盘 → 提供商 → 检查状态(绿色 = 已激活)
   ```

2. **检查模型 ID 格式:**
   ```
   正确: cc/claude-opus-4-5-20251101
   错误: claude-opus-4-5-20251101
   
   格式: [provider-prefix]/[model-name]
   ```

3. **列出可用模型:**
   ```bash
   curl http://localhost:20128/v1/models \
     -H "Authorization: Bearer your-api-key"
   ```

4. **重新连接提供商:**
   ```
   仪表盘 → 提供商 → [提供商] → 重新连接
   ```

---

## 响应缓慢

**问题:** 请求耗时过长或超时。

**原因:**
- 提供商延迟
- 网络问题
- 上下文/响应过大
- 提供商速率限制

**解决方案:**

1. **查看提供商状态:**
   ```
   仪表盘 → 提供商 → 查看延迟统计
   ```

2. **切换到更快的模型:**
   ```
   快速: cc/claude-haiku-4-5 (Haiku 比 Opus 快)
         gc/gemini-3-flash-preview
         qw/qwen3-coder-flash
   ```

3. **使用流式响应:**
   ```json
   {
     "model": "cc/claude-opus-4-5",
     "messages": [...],
     "stream": true
   }
   ```

4. **检查网络:**
   ```bash
   # 测试延迟
   ping api.anthropic.com
   ping api.openai.com
   ```

5. **减小上下文:**
   - 精简消息历史
   - 使用更短的 prompt
   - 在 CLI 工具中启用上下文裁剪

---

## API Key 无效

**问题:** 出现 "Invalid API key" 或 "Authentication failed" 错误。

**原因:**
- 复制了错误的 API key
- API key 已过期
- 未生成 API key

**解决方案:**

1. **重新生成 API key:**
   ```
   仪表盘 → 设置 → API Keys → 生成新 Key
   → 复制并使用新 key
   ```

2. **检查 key 格式:**
   ```
   正确: 9r_xxxxxxxxxxxxxxxxxxxxxxxx
   错误: 缺少 9r_ 前缀
   ```

3. **检查 CLI 配置中的 key:**
   ```bash
   # Cursor
   Settings → Models → OpenAI API Key
   
   # Cline
   Settings → API Key
   
   # 环境变量
   export OPENAI_API_KEY="9r_your_key"
   ```

4. **测试 API key:**
   ```bash
   curl http://localhost:20128/v1/models \
     -H "Authorization: Bearer 9r_your_key"
   ```

---

## 需要更多帮助?

- **GitHub Issues:** [github.com/decolua/9router/issues](https://github.com/decolua/9router/issues)
- **文档:** [9router.com/docs](https://9router.com/docs)
- **常见问题:** [faq.md](faq.md)
