# Continue VSCode 扩展集成

将 9Router 与 Continue 扩展集成,直接在 Visual Studio Code 中获得 AI 协助。

## 前置要求

- 已安装 Visual Studio Code
- 从 VSCode 市场安装了 Continue 扩展
- 来自 [仪表盘](https://9router.com/dashboard) 的 9Router API key
- 9Router 正在运行(本地或云端)

## 配置步骤

### 1. 打开 Continue 配置

1. 打开 VSCode
2. 按 `Cmd+Shift+P` (Mac) 或 `Ctrl+Shift+P` (Windows/Linux)
3. 输入 "Continue: Open Config" 并选择
4. 这会打开 `~/.continue/config.json`

### 2. 添加 9Router 模型配置

将以下配置添加到 `config.json`:

**单模型设置:**
```json
{
  "models": [
    {
      "title": "9Router - Claude Opus",
      "provider": "openai",
      "model": "cc/claude-opus-4-5-20251101",
      "apiKey": "your-api-key-from-dashboard",
      "apiBase": "http://localhost:20128/v1"
    }
  ]
}
```

**多模型设置:**
```json
{
  "models": [
    {
      "title": "9Router - Claude Opus (Best)",
      "provider": "openai",
      "model": "cc/claude-opus-4-5-20251101",
      "apiKey": "your-api-key-from-dashboard",
      "apiBase": "http://localhost:20128/v1"
    },
    {
      "title": "9Router - Claude Sonnet (Balanced)",
      "provider": "openai",
      "model": "cc/claude-sonnet-4-20250514",
      "apiKey": "your-api-key-from-dashboard",
      "apiBase": "http://localhost:20128/v1"
    },
    {
      "title": "9Router - DeepSeek Chat (Code)",
      "provider": "openai",
      "model": "cx/deepseek-chat",
      "apiKey": "your-api-key-from-dashboard",
      "apiBase": "http://localhost:20128/v1"
    },
    {
      "title": "9Router - Claude Haiku (Fast)",
      "provider": "openai",
      "model": "cc/claude-haiku-4-20250514",
      "apiKey": "your-api-key-from-dashboard",
      "apiBase": "http://localhost:20128/v1"
    }
  ]
}
```

**云端 9Router:**
将 `apiBase` 替换为:
```json
"apiBase": "https://9router.com/v1"
```

### 3. 保存并重新加载

1. 保存配置文件
2. 重新加载 VSCode 窗口:`Cmd+Shift+P` → "Developer: Reload Window"
3. Continue 扩展会加载新配置

### 4. 选择模型

1. 打开 Continue 侧边栏(点击左侧 Continue 图标)
2. 点击顶部模型选择下拉菜单
3. 选择你偏好的 9Router 模型

## 可用模型

### Claude 模型(Anthropic)
- `cc/claude-opus-4-5-20251101` - 最强,适合复杂任务
- `cc/claude-sonnet-4-20250514` - 性能与速度平衡
- `cc/claude-haiku-4-20250514` - 最快,适合简单任务

### DeepSeek 模型
- `cx/deepseek-chat` - 出色的代码生成
- `cx/deepseek-reasoner` - 复杂问题求解

### GLM 模型(Zhipu AI)
- `glm/glm-4-plus` - 高级中文与英文
- `glm/glm-4-flash` - 快速响应

## 使用示例

### 代码解释
1. 在编辑器中选中代码
2. 打开 Continue 侧边栏
3. 输入:"Explain this code"
4. 模型:`cc/claude-sonnet-4-20250514`

### 代码生成
1. 打开 Continue 侧边栏
2. 输入:"Create a React component for user profile card"
3. 模型:`cx/deepseek-chat`

### 重构
1. 选中要重构的代码
2. 输入:"Refactor this to use async/await"
3. 模型:`cc/claude-sonnet-4-20250514`

### Bug 修复
1. 选中有问题的代码
2. 输入:"Find and fix the bug in this code"
3. 模型:`cx/deepseek-reasoner`

## 高级配置

### 自定义系统 Prompt

为特定行为添加自定义系统 prompt:

```json
{
  "models": [
    {
      "title": "9Router - Code Expert",
      "provider": "openai",
      "model": "cx/deepseek-chat",
      "apiKey": "your-api-key",
      "apiBase": "http://localhost:20128/v1",
      "systemMessage": "You are an expert programmer. Always provide clean, well-documented code with best practices."
    }
  ]
}
```

### Temperature 与参数

通过参数调整模型行为:

```json
{
  "models": [
    {
      "title": "9Router - Creative Writer",
      "provider": "openai",
      "model": "cc/claude-opus-4-5-20251101",
      "apiKey": "your-api-key",
      "apiBase": "http://localhost:20128/v1",
      "temperature": 0.9,
      "topP": 0.95
    }
  ]
}
```

### Context Provider

配置 Continue 发送给模型的上下文:

```json
{
  "contextProviders": [
    {
      "name": "code",
      "params": {
        "maxLines": 100
      }
    },
    {
      "name": "diff",
      "params": {}
    },
    {
      "name": "terminal",
      "params": {}
    }
  ]
}
```

## 键盘快捷键

- `Cmd+L` (Mac) / `Ctrl+L` (Windows/Linux) - 打开 Continue 聊天
- `Cmd+I` (Mac) / `Ctrl+I` (Windows/Linux) - 内联编辑
- `Cmd+Shift+R` (Mac) / `Ctrl+Shift+R` (Windows/Linux) - 重新生成响应

## 故障排除

### 模型无响应
- 确认 9Router 正在运行:`curl http://localhost:20128/health`
- 检查 config.json 中的 API key
- 查看 VSCode 开发者控制台错误:`Help` → `Toggle Developer Tools`

### 选错模型
- 点击 Continue 侧边栏的模型下拉菜单
- 选择正确的 9Router 模型
- 模型名必须完全匹配(大小写敏感)

### 配置未加载
- 确认 JSON 语法有效(使用 JSON 验证工具)
- 检查文件位置:`~/.continue/config.json`
- 修改后重新加载 VSCode 窗口

### 性能缓慢
- 切换到更快的模型(haiku、flash)
- 在 contextProviders 中减少上下文大小
- 检查到 9Router 的网络延迟

## 最佳实践

### 模型选择策略
- **快速编辑**:使用 `cc/claude-haiku-4-20250514`
- **代码生成**:使用 `cx/deepseek-chat`
- **复杂重构**:使用 `cc/claude-opus-4-5-20251101`
- **问题求解**:使用 `cx/deepseek-reasoner`

### 上下文管理
- 提问前只选中相关代码
- 使用具体、清晰的 prompt
- 将复杂任务拆分为小步骤

### 成本优化
- 简单任务使用更快/更便宜的模型
- 尽可能限制上下文大小
- 缓存常用响应

## 下一步

- [配置 Cursor](cursor.md) 以增强 IDE 集成
- [设置 Roo](roo.md) AI 助手
- [探索 CLI 用法](../cli/basic-usage.md)
- [了解模型选择](../models/overview.md)
