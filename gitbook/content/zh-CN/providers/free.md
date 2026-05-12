# 免费提供商 - 零成本回退

当其他一切都受配额限制时的应急备用。零成本 24/7 编码!

---

## 概览

免费层提供商是订阅和低价配额都耗尽时的 **回退**:

- 🆓 **iFlow** - 8 个免费模型(Kimi K2、Qwen3、GLM 4.7、MiniMax M2...)
- 🆓 **Qwen** - 3 个免费模型(Qwen3 Coder Plus/Flash、Vision)
- 🆓 **Kiro** - 2 个免费模型(Claude Sonnet 4.5、Haiku 4.5)

**策略:** 作为应急备用使用。无限用量,永久零成本!

---

## iFlow(8 个免费模型)

### 价格

| 套餐 | 月费 | 模型 | 配额 |
|------|--------------|--------|-------|
| 免费 | $0 | 8 个模型 | 无限 |

**最佳价值:** 免费层中模型最多!Kimi K2、Qwen3、GLM、MiniMax、DeepSeek。

### 设置

**步骤 1:通过仪表盘连接**

```bash
9router
# 仪表盘 → 提供商 → 连接 iFlow
```

**步骤 2:iFlow OAuth 登录**

- 点击 "Connect iFlow"
- 浏览器打开 → iFlow 登录页
- 创建账户或登录
- 授予权限
- 启用自动 token 刷新

**步骤 3:在 CLI 中使用**

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

### 可用模型

| 模型 ID | 描述 | 最佳场景 |
|----------|-------------|----------|
| `if/kimi-k2-thinking` | Kimi K2 Thinking | 复杂推理 |
| `if/kimi-k2` | Kimi K2 | 通用编码 |
| `if/qwen3-coder-plus` | Qwen3 Coder Plus | 代码生成 |
| `if/glm-4.7` | GLM 4.7 | 中文 + 英文 |
| `if/minimax-m2` | MiniMax M2 | 长上下文 |
| `if/deepseek-r1` | DeepSeek R1 | 推理任务 |
| `if/deepseek-v3.2-chat` | DeepSeek V3.2 Chat | 对话型 |
| `if/deepseek-v3.2-reasoner` | DeepSeek V3.2 Reasoner | 复杂逻辑 |

### 专业建议

- **8 个免费模型** - 免费层中最丰富
- **无限用量** - 无配额限制
- **Kimi K2 Thinking** - 复杂推理最佳
- **DeepSeek R1** - 强大的推理能力

---

## Qwen(3 个免费模型)

### 价格

| 套餐 | 月费 | 模型 | 配额 |
|------|--------------|--------|-------|
| 免费 | $0 | 3 个模型 | 无限 |

### 设置

**步骤 1:通过仪表盘连接**

```bash
9router
# 仪表盘 → 提供商 → 连接 Qwen
```

**步骤 2:设备码授权**

- 点击 "Connect Qwen"
- 仪表盘显示设备码
- 访问授权 URL
- 输入设备码
- 登录 Qwen 账户
- 启用自动 token 刷新

**步骤 3:在 CLI 中使用**

```
Model: qw/qwen3-coder-plus
       qw/qwen3-coder-flash
       qw/vision-model
```

### 可用模型

| 模型 ID | 描述 | 最佳场景 |
|----------|-------------|----------|
| `qw/qwen3-coder-plus` | Qwen3 Coder Plus | 高级编码 |
| `qw/qwen3-coder-flash` | Qwen3 Coder Flash | 快速响应 |
| `qw/vision-model` | Qwen3 Vision | 图像分析 |

### 专业建议

- **Qwen3 Coder Plus** - 编码能力强
- **Qwen3 Coder Flash** - 快速任务首选
- **Vision 模型** - 免费图像分析
- **无限用量** - 无配额限制

---

## Kiro(免费 Claude)

### 价格

| 套餐 | 月费 | 模型 | 配额 |
|------|--------------|--------|-------|
| 免费 | $0 | Claude Sonnet 4.5、Haiku 4.5 | 无限 |

**最佳价值:** 免费 Claude!与付费 Claude Code 同质量。

### 设置

**步骤 1:通过仪表盘连接**

```bash
9router
# 仪表盘 → 提供商 → 连接 Kiro
```

**步骤 2:AWS Builder ID 或 OAuth**

- 点击 "Connect Kiro"
- 选择登录方式:
  - AWS Builder ID(推荐)
  - Google 账户
  - GitHub 账户
- 授予权限
- 启用自动 token 刷新

**步骤 3:在 CLI 中使用**

```
Model: kr/claude-sonnet-4.5
       kr/claude-haiku-4.5
```

### 可用模型

| 模型 ID | 描述 | 最佳场景 |
|----------|-------------|----------|
| `kr/claude-sonnet-4.5` | Claude Sonnet 4.5 | 质量/速度平衡 |
| `kr/claude-haiku-4.5` | Claude Haiku 4.5 | 快速响应 |

### 专业建议

- **免费 Claude** - 与付费层同质量
- **AWS Builder ID** - 用 AWS 账户轻松设置
- **无限用量** - 无配额限制
- **顶级质量** - 免费的 Claude 4.5!

---

## 特性对比

| 提供商 | 模型 | 最佳模型 | 设置方式 | 配额 |
|----------|--------|------------|-------|-------|
| **iFlow** | 8 | Kimi K2 Thinking | OAuth | 无限 |
| **Qwen** | 3 | Qwen3 Coder Plus | 设备码 | 无限 |
| **Kiro** | 2 | Claude Sonnet 4.5 | AWS Builder ID | 无限 |

**赢家:** 多样性看 iFlow,质量看 Kiro!

---

## 使用示例

### Cursor IDE 设置

```
Settings → Models → Advanced:
  OpenAI API Base URL: http://localhost:20128/v1
  OpenAI API Key: [从 9router 仪表盘获取]
  Model: if/kimi-k2-thinking
```

### 创建组合(推荐)

```
仪表盘 → 组合 → 新建

名称: free-combo
模型:
  1. if/kimi-k2-thinking (iFlow 主力)
  2. qw/qwen3-coder-plus (Qwen 备用)
  3. kr/claude-sonnet-4.5 (Kiro 质量)

CLI 中使用: free-combo
```

**结果:** 零成本,最大在线!

---

## 完整回退策略

### 完整 3 层组合

```
仪表盘 → 组合 → 新建

名称: complete-fallback
模型:
  1. gc/gemini-3-flash-preview (免费订阅)
  2. cc/claude-opus-4-5 (付费订阅)
  3. glm/glm-4.7 (低价备用, 每 1M $0.6)
  4. minimax/MiniMax-M2.1 (最便宜, 每 1M $0.2)
  5. if/kimi-k2-thinking (免费回退)
  6. kr/claude-sonnet-4.5 (免费质量)

CLI 中使用: complete-fallback
```

**结果:**
- 第 1 层: 免费订阅(Gemini CLI)
- 第 2 层: 付费订阅(Claude Code)
- 第 3 层: 低价备用(GLM、MiniMax)
- 第 4 层: 免费回退(iFlow、Kiro)

**永不停码!**

---

## 最佳实践

### 1. 作为应急备用

```
优先级:
1. 订阅层(最大化付费配额)
2. 低价层(每 1M tokens 几分钱)
3. 免费层(无限,零成本)

仅在以下情况使用免费层:
- 订阅配额耗尽
- 预算上限达到
- 测试/非关键任务
```

### 2. 选择合适的模型

```
复杂推理: if/kimi-k2-thinking
快速编码: qw/qwen3-coder-flash
最佳质量: kr/claude-sonnet-4.5
长上下文: if/minimax-m2
视觉任务: qw/vision-model
```

### 3. 创建仅免费组合

```
零成本编码:

名称: zero-cost
模型:
  1. kr/claude-sonnet-4.5 (最佳质量)
  2. if/kimi-k2-thinking (复杂任务)
  3. qw/qwen3-coder-plus (快速编码)

成本: 永远 $0!
```

### 4. 上生产前先测试

```
用免费层来:
- 测试 prompt
- 原型功能
- 学习新框架
- 非关键任务

把付费配额留给:
- 生产代码
- 复杂重构
- 关键功能
```

---

## 真实案例

### 案例 1:学生/学习者(零预算)

```
设置:
1. kr/claude-sonnet-4.5 (最佳质量)
2. if/kimi-k2-thinking (复杂推理)
3. qw/qwen3-coder-plus (快速编码)

月成本: $0
用量: 无限

适合:
- 学习编程
- 个人项目
- 作业/任务
```

### 案例 2:自由职业(预算敏感)

```
设置:
1. gc/gemini-3-flash-preview (每月免费 180K)
2. glm/glm-4.7 (低价备用, 每 1M $0.6)
3. if/kimi-k2-thinking (免费回退)

月成本: $5-10
用量: 100M+ tokens

适合:
- 客户项目(付费层)
- 测试(免费层)
- 应急备用
```

### 案例 3:重度用户(全部最大化)

```
设置:
1. gc/gemini-3-flash-preview (每月免费 180K)
2. cc/claude-opus-4-5 (订阅 $20-100)
3. cx/gpt-5.2-codex (订阅 $20-200)
4. glm/glm-4.7 (低价 每 1M $0.6)
5. minimax/MiniMax-M2.1 (最便宜 每 1M $0.2)
6. if/kimi-k2-thinking (免费无限)
7. kr/claude-sonnet-4.5 (免费质量)

月成本: $40-320(订阅)+ $10-20(低价层)
用量: 500M+ tokens

适合:
- 专业开发
- 团队项目
- 24/7 编码
```

---

## 成本对比

### 场景:每月 100M tokens

**方案 1:仅 ChatGPT API**
```
100M × $20/1M = $2,000/月
```

**方案 2:仅 9Router 免费层**
```
100M 通过免费层 = $0/月
节省: $2,000/月 (100%)
```

**方案 3:9Router 完整策略**
```
60M 通过 Gemini CLI(免费): $0
30M 通过 Claude Code(订阅): 无额外费用
8M 通过 GLM(低价): $4.80
2M 通过 iFlow(免费): $0
合计: $4.80/月 + 你已有的订阅
节省: $1,995/月 (99.76%)
```

---

## 故障排除

### "OAuth failed"

**方案:**
- 检查网络连接
- 尝试其他浏览器
- 清除浏览器缓存
- 在仪表盘重新连接

### "Model not available"

**方案:**
- 检查仪表盘中提供商已连接
- 确认 OAuth token 有效
- 必要时重新连接提供商

### "Slow responses"

**方案:**
- 免费层优先级较低
- 在非高峰时段使用
- 切换到其他免费提供商
- 升级到低价层以提速

---

## 限制

### 免费层注意事项

- **速度** - 可能慢于付费层
- **优先级** - 高峰期优先级较低
- **速率限制** - 可能限速(但配额无限)
- **可用性** - 偶尔可能宕机

**方案:** 使用 3 层回退策略保障可靠性!

---

## 下一步

- **设置订阅:** [订阅型提供商](./subscription.md)
- **添加低价备用:** [低价提供商](./cheap.md)
- **创建组合:** 仪表盘 → 组合 → 新建
- **开始编码:** 使用 `complete-fallback` 组合最大化可靠性
