# Cursor 集成

将 9Router 与 Cursor IDE 集成,通过 9Router 的智能路由系统转发你的 AI 请求。

## 前置要求

- 已安装 Cursor IDE
- Cursor Pro 账户(使用自定义 API endpoint 必需)
- 已配置 9Router 云端 endpoint
- 来自 9Router 仪表盘的 API key

## ⚠️ 重要说明

> **必须使用云端 Endpoint**:Cursor 会通过自己的服务器转发请求,不支持 localhost endpoint。你必须使用 9Router 云端 endpoint:`https://9router.com`

> **必须有 Cursor Pro**:此功能需要 Cursor Pro 账户才能使用自定义 API endpoint。

## 设置

### 1. 打开 Cursor 设置

1. 打开 Cursor IDE
2. 进入 **Settings**(Cmd/Ctrl + ,)
3. 导航到 **Models** 部分

### 2. 启用 OpenAI API

1. 找到 **OpenAI API key** 选项
2. 启用开关以激活自定义 API 配置

### 3. 配置 Base URL

将 base URL 设为 9Router 云端 endpoint:

```
https://9router.com
```

**步骤:**
1. 在 Models 设置中找到 **Base URL** 字段
2. 输入:`https://9router.com`
3. 点击 **Save**

### 4. 添加 API Key

1. 在 **API Key** 字段中输入你的 9Router API key
2. 可在 9Router 仪表盘 **Settings → API Keys** 中找到 API key
3. 点击 **Save**

### 5. 添加自定义模型

1. 点击 **View All Models** 按钮
2. 点击 **Add Custom Model**
3. 输入 9Router 配置中的模型名(例如 `gpt-4`、`claude-opus-4-5` 等)
4. 点击 **Add**

### 6. 选择模型

1. 在 Cursor 聊天界面,点击模型选择下拉菜单
2. 从列表中选择你的自定义模型
3. 开始在 Cursor 中使用 9Router!

## 配置示例

你的 Cursor 设置应如下所示:

```
OpenAI API: ✓ 已启用
Base URL: https://9router.com
API Key: sk-9router-xxxxxxxxxxxxx
Custom Models: gpt-4, claude-opus-4-5, gemini-2.0-flash
```

## 可用模型

你可以使用 9Router 仪表盘中配置的任意模型。常见示例:

| 模型名 | 提供商 | 描述 |
|------------|----------|-------------|
| `gpt-4` | OpenAI | GPT-4 Turbo |
| `gpt-4o` | OpenAI | GPT-4 Optimized |
| `claude-opus-4-5` | Anthropic | Claude Opus 4.5 |
| `claude-sonnet-4-5` | Anthropic | Claude Sonnet 4.5 |
| `gemini-2.0-flash` | Google | Gemini 2.0 Flash |

## 使用

### 聊天界面

1. 打开 Cursor 聊天(Cmd/Ctrl + L)
2. 从下拉菜单中选择模型
3. 通过 9Router 与 AI 对话

### 内联代码生成

1. 在编辑器中选中代码
2. 按 Cmd/Ctrl + K
3. 输入 prompt
4. Cursor 会通过 9Router 生成代码

### 代码解释

1. 在编辑器中选中代码
2. 按 Cmd/Ctrl + L
3. 询问 "Explain this code"
4. 通过 9Router 获得 AI 驱动的解释

## 故障排除

### "Invalid API Key" 错误

1. 在 9Router 仪表盘中确认 API key
2. 确保复制了包含 `sk-9router-` 前缀在内的完整 key
3. 检查 API key 是否过期
4. 尝试重新生成 API key

### "Model Not Found" 错误

1. 确认模型名与 9Router 配置完全一致
2. 检查 9Router 仪表盘中提供商连接是否激活
3. 确认连接的提供商中包含该模型
4. 尝试使用完整模型名(例如用 `openai/gpt-4` 代替 `gpt-4`)

### 连接问题

1. 确认使用的是云端 endpoint:`https://9router.com`
2. 检查网络连接
3. 确认 9Router 云端服务运行正常
4. 若启用了 VPN 或代理,尝试关闭

### Localhost 无法使用

> **请记住**:Cursor 不支持 localhost endpoint。你必须使用云端 endpoint `https://9router.com`。如果需要使用本地 9Router 实例,可以考虑使用 ngrok 之类的隧道服务把本地 endpoint 暴露到公网。

## 云端 Endpoint 设置

如果你在本地运行 9Router 并希望搭配 Cursor 使用:

1. 在 9Router 设置中启用云端 endpoint
2. 在 9Router 仪表盘中配置云端 endpoint URL
3. 在 Cursor 设置中使用该云端 URL
4. 确保本地 9Router 实例可从互联网访问

## 最佳实践

1. **使用模型别名**:为常用模型在 9Router 中创建简短别名
2. **监控使用**:在 9Router 仪表盘查看用量统计和成本
3. **轮换 API Keys**:为安全起见定期轮换 API key
4. **测试模型**:尝试不同模型,找到最适合你场景的那个
