# Cursor 集成

将 10router 与 Cursor IDE 集成,通过 10router 的智能路由系统转发你的 AI 请求。

## 前置要求

- 已安装 Cursor IDE
- Cursor Pro 账户(使用自定义 API endpoint 必需)
- 一个可从公网访问的 10router endpoint(VPS,或指向本地实例的隧道)
- 来自你的 10router 仪表盘的 API key

## ⚠️ 重要说明

> **必须使用公网 Endpoint**:Cursor 会通过自己的服务器转发请求,不支持 localhost endpoint。你必须把它指向一个可从公网访问的 10router URL,例如 `https://your-10router-host`

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

将 base URL 设为你的 10router endpoint:

```
https://your-10router-host
```

**步骤:**
1. 在 Models 设置中找到 **Base URL** 字段
2. 输入:`https://your-10router-host`
3. 点击 **Save**

### 4. 添加 API Key

1. 在 **API Key** 字段中输入你的 10router API key
2. 可在 10router 仪表盘 **Settings → API Keys** 中找到 API key
3. 点击 **Save**

### 5. 添加自定义模型

1. 点击 **View All Models** 按钮
2. 点击 **Add Custom Model**
3. 输入 10router 配置中的模型名(例如 `gpt-4`、`claude-opus-4-5` 等)
4. 点击 **Add**

### 6. 选择模型

1. 在 Cursor 聊天界面,点击模型选择下拉菜单
2. 从列表中选择你的自定义模型
3. 开始在 Cursor 中使用 10router!

## 配置示例

你的 Cursor 设置应如下所示:

```
OpenAI API: ✓ 已启用
Base URL: https://your-10router-host
API Key: sk-10router-xxxxxxxxxxxxx
Custom Models: gpt-4, claude-opus-4-5, gemini-2.0-flash
```

## 可用模型

你可以使用 10router 仪表盘中配置的任意模型。常见示例:

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
3. 通过 10router 与 AI 对话

### 内联代码生成

1. 在编辑器中选中代码
2. 按 Cmd/Ctrl + K
3. 输入 prompt
4. Cursor 会通过 10router 生成代码

### 代码解释

1. 在编辑器中选中代码
2. 按 Cmd/Ctrl + L
3. 询问 "Explain this code"
4. 通过 10router 获得 AI 驱动的解释

## 故障排除

### "Invalid API Key" 错误

1. 在 10router 仪表盘中确认 API key
2. 确保复制了包含 `sk-10router-` 前缀在内的完整 key
3. 检查 API key 是否过期
4. 尝试重新生成 API key

### "Model Not Found" 错误

1. 确认模型名与 10router 配置完全一致
2. 检查 10router 仪表盘中提供商连接是否激活
3. 确认连接的提供商中包含该模型
4. 尝试使用完整模型名(例如用 `openai/gpt-4` 代替 `gpt-4`)

### 连接问题

1. 确认使用的是你的公网 endpoint:`https://your-10router-host`
2. 检查网络连接
3. 确认你的 10router 实例正在运行且可从公网访问
4. 若启用了 VPN 或代理,尝试关闭

### Localhost 无法使用

> **请记住**:Cursor 不支持 localhost endpoint,必须通过公网 URL 访问 10router。如果你在本地运行 10router,请使用 ngrok 或 Cloudflare Tunnel 之类的隧道服务把它暴露到公网。

## 暴露本地实例

如果你在本地运行 10router 并希望搭配 Cursor 使用:

1. 在本地启动 10router(默认端口 `20128`)
2. 为其开启隧道,例如 `ngrok http 20128` 或 `cloudflared tunnel --url http://localhost:20128`
3. 把隧道给出的公网 HTTPS URL 填入 Cursor 设置的 Base URL
4. 使用 Cursor 期间保持本地实例和隧道都在运行

## 最佳实践

1. **使用模型别名**:为常用模型在 10router 中创建简短别名
2. **监控使用**:在 10router 仪表盘查看用量统计和成本
3. **轮换 API Keys**:为安全起见定期轮换 API key
4. **测试模型**:尝试不同模型,找到最适合你场景的那个
