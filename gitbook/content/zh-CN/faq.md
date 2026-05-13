# 常见问题

关于 9Router 的常见问题。

---

## 什么是 9Router?

**9Router 是一款 AI 模型路由工具,能够最大化你的订阅价值并最小化成本。**

它使用 3 层回退系统在多个 AI 提供商之间智能路由请求:
1. **订阅层** - 充分利用你已付费的 Claude Code、Codex、Gemini 配额
2. **低价层** - 超低价替代方案(每 1M tokens $0.20-$0.60)
3. **免费层** - 无限免费模型应急备用

**核心优势:**
- 不再浪费订阅配额
- 配额耗尽时自动回退
- 实时配额跟踪
- 比直接使用 API 节省 90% 成本

---

## 价格是如何计算的?

**9Router 采用三层定价策略:**

### 第 1 层:订阅(优先使用)
- **Claude Code**(Pro/Max):$20-100/月 - 5 小时 + 每周配额
- **OpenAI Codex**(Plus/Pro):$20-200/月 - 5 小时 + 每周配额
- **Gemini CLI**:免费 - 每月 180K 次补全 + 每天 1K
- **GitHub Copilot**:$10-19/月 - 每月重置
- **Antigravity**:免费 - 类似 Gemini

**目标:** 在配额重置前用掉每一点!

### 第 2 层:低价(备用)
- **GLM-4.7**:每 1M tokens $0.60/$2.20 - 每日 10AM 重置
- **MiniMax M2.1**:每 1M tokens $0.20/$1.00 - 5 小时滚动
- **Kimi K2**:$9/月固定(10M tokens)

**目标:** 比 ChatGPT API(每 1M $20)便宜 90%!

### 第 3 层:免费(应急)
- **iFlow**:8 个免费模型(Kimi K2、Qwen3、GLM、MiniMax...)
- **Qwen**:3 个免费模型(Qwen3 Coder Plus/Flash、Vision)
- **Kiro**:2 个免费模型(Claude Sonnet 4.5、Haiku 4.5)

**目标:** 当其他配额都受限时零成本回退!

---

## 9Router 是免费的吗?

**是的,9Router 本身 100% 免费且开源。**

**可用的免费层提供商:**
- **Gemini CLI** - 每月 180K 次补全(免费 Google 账户)
- **iFlow** - 8 个无限模型(免费 OAuth)
- **Qwen** - 3 个无限模型(免费 OAuth)
- **Kiro** - Claude Sonnet/Haiku(免费 AWS Builder ID)

**只用免费层提供商,就可以永久免费编码!**

**可选的付费提供商:**
- 你可能已有的订阅服务(Claude Code、Codex、Copilot)
- 超低价替代方案(每 1M tokens $0.20-$0.60)

---

## 支持哪些提供商?

### 订阅型提供商
- **Claude Code**(Pro/Max)- Claude 4.5 Opus/Sonnet/Haiku
- **OpenAI Codex**(Plus/Pro)- GPT 5.2 Codex、GPT 5.1 Codex Max
- **Gemini CLI**(免费)- Gemini 3 Flash/Pro、2.5 Pro/Flash
- **GitHub Copilot** - GPT-5、Claude 4.5、Gemini 3
- **Antigravity**(Google)- Gemini 3 Pro、Claude Sonnet 4.5

### 低价提供商
- **GLM**(Zhipu AI)- GLM 4.7、GLM 4.6V Vision
- **MiniMax** - MiniMax M2.1
- **Kimi**(Moonshot AI)- Kimi Latest
- **OpenRouter** - 透传到任意 OpenRouter 模型

### 免费提供商
- **iFlow** - 8 个模型(Kimi K2、Qwen3、GLM、MiniMax、DeepSeek...)
- **Qwen** - 3 个模型(Qwen3 Coder Plus/Flash、Vision)
- **Kiro** - 2 个模型(Claude Sonnet 4.5、Haiku 4.5)

**合计:15+ 个提供商,50+ 个模型**

详情请见 [提供商文档](providers/subscription.md)。

---

## 可以同时使用多个提供商吗?

**可以!这正是 9Router 的核心功能。**

**通过组合(Combos),你可以把多个提供商串联起来实现自动回退:**

```
示例组合: "premium-coding"
1. cc/claude-opus-4-5(订阅主力)
2. glm/glm-4.7(低价备用)
3. if/kimi-k2(免费应急)

→ 配额耗尽时自动切换
→ 永不停止编码
→ 几乎零额外成本
```

**创建组合的方法:**
```
仪表盘 → 组合 → 新建
→ 按优先级添加模型
→ CLI 中使用组合名: "premium-coding"
```

**优势:**
- 配额耗尽时零停机
- 自动成本优化
- 所有工具使用同一个模型名

详情见 [组合文档](features/combos.md)。

---

## 配额跟踪是如何工作的?

**9Router 为所有提供商提供实时配额跟踪:**

**功能:**
- **Token 消耗** - 每次请求的输入/输出 tokens
- **重置倒计时** - 配额刷新前剩余时间
- **使用统计** - 每日/每周/每月报告
- **成本估算** - 预计支出(付费层)
- **配额告警** - 配额不足时通知

**配额类型:**
- **5 小时滚动** - Claude Code、Codex、MiniMax
- **每日重置** - Gemini CLI(每日 1K)、GLM(10AM)
- **每周重置** - Claude Code、Codex(额外配额)
- **每月重置** - Gemini CLI(180K)、GitHub Copilot(1 日)

**查看配额:**
```
仪表盘 → 提供商 → 配额跟踪
→ 实时使用情况 + 重置倒计时
```

详情见 [配额跟踪文档](features/quota-tracking.md)。

---

## 9Router 能配合 Cursor 使用吗?

**可以,但 Cursor 需要使用云端 endpoint。**

**问题:** Cursor IDE 不支持 localhost endpoint。

**解决方案:** 使用 9Router 云端部署:

```
Cursor Settings → Models → Advanced:
  OpenAI API Base URL: https://9router.com/v1
  OpenAI API Key: [从仪表盘获取]
  Model: cc/claude-opus-4-5-20251101
```

**替代方案:** 在 VPS 上自托管,使用公开域名:
```bash
# 部署到 VPS
git clone https://github.com/decolua/9router.git
cd 9router/app
npm install && npm run build
npm start

# 配置 Nginx 反向代理
# 将 Cursor 指向: https://your-domain.com/v1
```

**其他 CLI 工具支持 localhost:**
- Cline ✅
- Claude Desktop ✅
- Codex CLI ✅
- Continue ✅
- RooCode ✅

详情见 [Cursor 集成指南](integration/cursor.md)。

---

## 可以自托管 9Router 吗?

**可以!9Router 支持多种部署方式:**

### Localhost(默认)
```bash
npm install -g 9router
9router
→ 仪表盘: http://localhost:3000
→ API: http://localhost:20128/v1
```

### VPS/云
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

**环境变量:**
- `JWT_SECRET` - **生产环境必须修改!**
- `DATA_DIR` - 数据库存储路径(默认:`~/.9router`)
- `INITIAL_PASSWORD` - 仪表盘登录(默认:`123456`)
- `NODE_ENV` - 部署时设为 `production`

详情见 [部署指南](getting-started/installation.md#deployment)。

---

## 我的数据安全吗?

**是的,9Router 优先考虑安全和隐私:**

**本地存储:**
- 所有数据存储在本地 `~/.9router`(或自定义 `DATA_DIR`)
- 不会发送数据到 9Router 服务器
- OAuth tokens 使用 JWT 加密

**无遥测:**
- 不跟踪使用情况
- 不分析
- 不向外回连

**开源:**
- GitHub 上提供完整源码
- 可自行审计安全性
- 社区评审

**最佳实践:**
- 生产环境修改 `JWT_SECRET`
- 使用强 `INITIAL_PASSWORD`
- 云端部署启用 HTTPS
- 定期轮换 API keys

**9Router 存储的内容:**
- 提供商 OAuth tokens(加密)
- API keys(加密)
- 使用统计(仅本地)
- 组合配置

**9Router 不存储的内容:**
- 你的 prompt 或响应
- 你生成的代码
- 个人信息

---

## 如何更新 9Router?

**更新方式取决于安装类型:**

### 全局 NPM 安装
```bash
npm update -g 9router
```

### 本地安装
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

**查看版本:**
```bash
9router --version
```

**破坏性变更:**
- 查看 [CHANGELOG.md](https://github.com/decolua/9router/blob/main/CHANGELOG.md)
- 大版本更新前备份 `~/.9router`
- 阅读大版本的迁移指南

---

## 如何贡献?

**欢迎贡献!**

### 贡献方式:

1. **报告 bug:**
   - [GitHub Issues](https://github.com/decolua/9router/issues)
   - 附上错误日志、复现步骤

2. **功能请求:**
   - [GitHub Discussions](https://github.com/decolua/9router/discussions)
   - 描述使用场景和价值

3. **提交代码:**
   ```bash
   # Fork 仓库
   git clone https://github.com/YOUR_USERNAME/9router.git
   cd 9router
   
   # 创建分支
   git checkout -b feature/your-feature
   
   # 修改代码
   npm install
   npm run dev
   
   # 测试
   npm test
   
   # 提交并推送
   git add .
   git commit -m "Add your feature"
   git push origin feature/your-feature
   
   # 在 GitHub 上创建 Pull Request
   ```

4. **改进文档:**
   - 修正错别字、添加示例
   - 翻译到其他语言
   - 编写教程

5. **添加提供商:**
   - 实现新的 provider adapter
   - 参考 `app/lib/providers/` 中的示例

**贡献指南:**
- 遵循现有代码风格
- 为新功能添加测试
- 更新文档
- 提交保持原子化、描述清晰

详情见 [CONTRIBUTING.md](https://github.com/decolua/9router/blob/main/CONTRIBUTING.md)。

---

## 需要更多帮助?

- **文档:** [9router.com/docs](https://9router.com/docs)
- **GitHub:** [github.com/decolua/9router](https://github.com/decolua/9router)
- **Issues:** [github.com/decolua/9router/issues](https://github.com/decolua/9router/issues)
- **故障排除:** [troubleshooting.md](troubleshooting.md)
