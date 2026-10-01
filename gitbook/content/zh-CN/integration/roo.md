# Roo AI 助手集成

将 9Router 与 Roo AI 助手集成,通过统一界面访问多个 AI 模型。

## 前置要求

- 已安装 Roo AI 助手
- 来自 [仪表盘](https://9router.com/dashboard) 的 9Router API key
- 9Router 正在运行(本地或云端)

## 配置步骤

### 1. 打开 Roo 设置

启动 Roo AI 助手并打开设置面板。

### 2. 配置 API Provider

1. 进入 **API Provider** 设置
2. 选择 **Ollama** 作为 provider 类型
3. 配置以下设置:

**本地 9Router:**
```
Base URL: http://localhost:20128/v1
API Key: your-api-key-from-dashboard
```

**云端 9Router:**
```
Base URL: https://9router.com/v1
API Key: your-api-key-from-dashboard
```

### 3. 选择模型

从可用的 9Router 模型中选择:

**Claude 模型:**
- `cc/claude-opus-4-5-20251101` - 最强
- `cc/claude-sonnet-4-20250514` - 平衡
- `cc/claude-haiku-4-20250514` - 快速

**DeepSeek 模型:**
- `cx/deepseek-chat` - 通用
- `cx/deepseek-reasoner` - 复杂推理

**GLM 模型:**
- `glm/glm-4-plus` - 高级
- `glm/glm-4-flash` - 快速响应

### 4. 测试连接

发送测试消息验证集成:

```
Hello! Can you confirm you're connected through 9Router?
```

## 使用示例

### 基础聊天
```
向 Roo 提问: "Explain quantum computing in simple terms"
模型: cc/claude-sonnet-4-20250514
```

### 代码生成
```
向 Roo 提问: "Write a Python function to calculate Fibonacci numbers"
模型: cx/deepseek-chat
```

### 复杂推理
```
向 Roo 提问: "Analyze the trade-offs between microservices and monolithic architecture"
模型: cx/deepseek-reasoner
```

## 模型选择建议

- **快速任务**:使用 `cc/claude-haiku-4-20250514` 或 `glm/glm-4-flash`
- **均衡性能**:使用 `cc/claude-sonnet-4-20250514` 或 `cx/deepseek-chat`
- **复杂推理**:使用 `cc/claude-opus-4-5-20251101` 或 `cx/deepseek-reasoner`
- **成本优化**:使用 DeepSeek 或 GLM 模型

## 故障排除

### 连接失败
- 确认 9Router 正在运行:`curl http://localhost:20128/health`
- 检查 API key 是否正确
- 确保 Base URL 末尾包含 `/v1`

### 模型不可用
- 检查模型名是否完全匹配(大小写敏感)
- 确认 9Router 套餐中已启用该模型
- 尝试列表中的其他模型

### 响应缓慢
- 切换到更快的模型(haiku、flash)
- 检查网络连接
- 查看 9Router 日志排查问题

## 高级配置

### 自定义模型别名

可在 Roo 设置中为常用模型创建快捷别名:

```
别名: "fast" → cc/claude-haiku-4-20250514
别名: "smart" → cc/claude-opus-4-5-20251101
别名: "code" → cx/deepseek-chat
```

### 多个配置文件

为不同场景设置不同配置:
- **开发**:DeepSeek 模型用于编码
- **写作**:Claude 模型用于内容创作
- **研究**:Reasoner 模型用于分析

## 下一步

- [配置 Cursor](cursor.md) 进行 IDE 集成
- [设置 Continue](continue.md) 用于 VSCode
- [探索 CLI 用法](../cli/basic-usage.md)
