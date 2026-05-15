# Cline 集成

将 9Router 与 Cline VSCode 扩展集成,通过 9Router 的智能路由系统转发你的 AI 请求。

## 前置要求

- 已安装 Visual Studio Code
- 从 VSCode 市场安装了 Cline 扩展
- 9Router 本地运行或已配置云端 endpoint
- 来自 9Router 仪表盘的 API key

## 设置

### 1. 打开 Cline 设置

1. 打开 Visual Studio Code
2. 打开 Cline 扩展面板(点击侧边栏的 Cline 图标)
3. 点击 Cline 面板中的 **Settings**(齿轮图标)

### 2. 选择 API Provider

1. 在 Cline 设置中找到 **API Provider** 下拉菜单
2. 从列表中选择 **Ollama**
   - 注意:我们使用 Ollama provider 类型,因为它与 OpenAI 风格 API 兼容

### 3. 配置 Base URL

将 base URL 设为你的 9Router endpoint:

**本地 9Router:**
```
http://localhost:20128/v1
```

**云端 9Router:**
```
https://9router.com
```

**步骤:**
1. 在 **Base URL** 字段中输入你的 9Router endpoint
2. 末尾必须包含 `/v1`

### 4. 添加 API Key

1. 在 **API Key** 字段中输入你的 9Router API key
2. 可在 9Router 仪表盘 **Settings → API Keys** 中找到 API key
3. key 应以 `sk-9router-` 开头

### 5. 选择模型

1. 在 **Model** 下拉菜单中,可以:
   - 从可用模型中选择(若 Cline 自动检测)
   - 或手动输入 9Router 配置中的模型名

2. 常见模型名:
   - `gpt-4`
   - `gpt-4o`
   - `claude-opus-4-5`
   - `claude-sonnet-4-5`
   - `gemini-2.0-flash`

### 6. 保存配置

点击 **Save** 或关闭设置面板。Cline 会自动保存你的配置。

## 配置示例

你的 Cline 设置应如下所示:

```
API Provider: Ollama
Base URL: http://localhost:20128/v1
API Key: sk-9router-xxxxxxxxxxxxx
Model: gpt-4
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

### 与 AI 对话

1. 在 VSCode 中打开 Cline 面板
2. 在聊天输入框中输入消息
3. 按 Enter 发送
4. Cline 会通过 9Router 处理你的请求

### 生成代码

1. 让 Cline 生成代码:"创建一个登录表单的 React 组件"
2. Cline 会通过 9Router 生成代码
3. 检查并接受生成的代码

### 代码解释

1. 在编辑器中选中代码
2. 让 Cline:"解释这段代码"
3. 通过 9Router 获得 AI 驱动的解释

### 文件操作

1. 让 Cline 创建、修改或删除文件
2. Cline 会通过 9Router 理解上下文并进行修改
3. 在接受前检查变更

## 故障排除

### "Connection Failed" 错误

1. 确认 9Router 正在运行:`curl http://localhost:20128/health`
2. 确认 base URL 正确且包含 `/v1`
3. 确保防火墙没有阻止 20128 端口
4. 尝试重启 VSCode

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

### Cline 无响应

1. 查看 Cline 输出面板中的错误信息
2. 确认 9Router 实例正在运行且健康
3. 重新加载 VSCode 窗口(Cmd/Ctrl + Shift + P → "Reload Window")
4. 检查 9Router 日志是否有错误

## 高级配置

### 使用云端 Endpoint

使用 9Router 云端 endpoint 而非 localhost:

1. 在 Cline 设置中将 Base URL 设为:`https://9router.com`
2. 确保已在 9Router 云端仪表盘中配置 API key
3. 确保云端 endpoint 已激活且可访问

### 多个模型

可以快速切换模型:

1. 打开 Cline 设置
2. 将 **Model** 字段改为另一个模型
3. 保存并继续使用新模型对话

### 自定义超时

如果大请求出现超时:

1. 打开 VSCode 设置(Cmd/Ctrl + ,)
2. 搜索 "Cline timeout"
3. 提高超时值(默认通常为 30 秒)

## 最佳实践

1. **使用合适的模型**:简单任务用更快的模型(如 Haiku 或 Flash),复杂任务用更强的模型(如 Opus 或 GPT-4)
2. **监控使用**:在 9Router 仪表盘查看用量统计和成本
3. **管理上下文**:保持对话聚焦以减少 token 用量
4. **切换模型**:根据任务复杂度切换模型,优化成本和性能
5. **API Key 安全**:绝不将 API key 提交到版本控制

## 与 9Router 功能的集成

### 模型路由

9Router 会根据以下因素自动将请求路由到最佳提供商:
- 模型可用性
- 提供商健康状态
- 成本优化
- 负载均衡

### 回退支持

某个提供商失败时,9Router 会自动回退到仪表盘中配置的备用提供商。

### 使用跟踪

通过 9Router 仪表盘监控你的 Cline 使用:
- 请求总数
- Token 使用
- 每个模型的成本
- 提供商分布
