# 其他工具集成

9Router 兼容任何支持 OpenAI API 格式的工具。本指南介绍各种工具和自定义应用的通用集成模式。

## 概览

9Router 提供 OpenAI 兼容的 API endpoint,可与以下场景配合使用:
- 自定义脚本与应用
- API 客户端与测试工具
- CLI 工具与实用程序
- 第三方集成
- 开发框架

## 通用设置模式

任何 OpenAI 兼容的工具都可以通过以下设置连接到 9Router:

**本地 9Router:**
```
Base URL: http://localhost:20128/v1
API Key: your-api-key-from-dashboard
Model: 任意 9Router 模型(cc/*, cx/*, glm/*, 等)
```

**云端 9Router:**
```
Base URL: https://9router.com/v1
API Key: your-api-key-from-dashboard
Model: 任意 9Router 模型(cc/*, cx/*, glm/*, 等)
```

## 可用模型

### Claude 模型(Anthropic)
- `cc/claude-opus-4-5-20251101`
- `cc/claude-sonnet-4-20250514`
- `cc/claude-haiku-4-20250514`

### DeepSeek 模型
- `cx/deepseek-chat`
- `cx/deepseek-reasoner`

### GLM 模型(Zhipu AI)
- `glm/glm-4-plus`
- `glm/glm-4-flash`

## 集成示例

### Python 使用 OpenAI SDK

```python
from openai import OpenAI

client = OpenAI(
    api_key="your-api-key-from-dashboard",
    base_url="http://localhost:20128/v1"
)

response = client.chat.completions.create(
    model="cc/claude-sonnet-4-20250514",
    messages=[
        {"role": "user", "content": "Hello, how are you?"}
    ]
)

print(response.choices[0].message.content)
```

### Node.js 使用 OpenAI SDK

```javascript
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "your-api-key-from-dashboard",
  baseURL: "http://localhost:20128/v1"
});

const response = await client.chat.completions.create({
  model: "cc/claude-sonnet-4-20250514",
  messages: [
    { role: "user", content: "Hello, how are you?" }
  ]
});

console.log(response.choices[0].message.content);
```

### cURL 命令

```bash
curl http://localhost:20128/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key-from-dashboard" \
  -d '{
    "model": "cc/claude-sonnet-4-20250514",
    "messages": [
      {"role": "user", "content": "Hello, how are you?"}
    ]
  }'
```

### HTTP 客户端(Postman、Insomnia)

**Request:**
```
POST http://localhost:20128/v1/chat/completions
```

**Headers:**
```
Content-Type: application/json
Authorization: Bearer your-api-key-from-dashboard
```

**Body:**
```json
{
  "model": "cc/claude-sonnet-4-20250514",
  "messages": [
    {"role": "user", "content": "Hello, how are you?"}
  ],
  "temperature": 0.7,
  "max_tokens": 1000
}
```

### LangChain 集成

```python
from langchain.chat_models import ChatOpenAI
from langchain.schema import HumanMessage

llm = ChatOpenAI(
    model_name="cc/claude-sonnet-4-20250514",
    openai_api_key="your-api-key-from-dashboard",
    openai_api_base="http://localhost:20128/v1",
    temperature=0.7
)

messages = [HumanMessage(content="Explain quantum computing")]
response = llm(messages)
print(response.content)
```

### LlamaIndex 集成

```python
from llama_index.llms import OpenAI

llm = OpenAI(
    model="cc/claude-sonnet-4-20250514",
    api_key="your-api-key-from-dashboard",
    api_base="http://localhost:20128/v1"
)

response = llm.complete("What is machine learning?")
print(response.text)
```

## 自定义脚本示例

### 批处理脚本

```python
import openai
import json

openai.api_key = "your-api-key-from-dashboard"
openai.api_base = "http://localhost:20128/v1"

def process_batch(prompts, model="cx/deepseek-chat"):
    results = []
    for prompt in prompts:
        response = openai.ChatCompletion.create(
            model=model,
            messages=[{"role": "user", "content": prompt}]
        )
        results.append({
            "prompt": prompt,
            "response": response.choices[0].message.content
        })
    return results

prompts = [
    "Explain AI in one sentence",
    "What is machine learning?",
    "Define neural networks"
]

results = process_batch(prompts)
print(json.dumps(results, indent=2))
```

### 流式响应处理

```javascript
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "your-api-key-from-dashboard",
  baseURL: "http://localhost:20128/v1"
});

async function streamResponse(prompt) {
  const stream = await client.chat.completions.create({
    model: "cc/claude-sonnet-4-20250514",
    messages: [{ role: "user", content: prompt }],
    stream: true
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || "";
    process.stdout.write(content);
  }
}

streamResponse("Write a short story about AI");
```

### 多模型对比

```python
from openai import OpenAI

client = OpenAI(
    api_key="your-api-key-from-dashboard",
    base_url="http://localhost:20128/v1"
)

models = [
    "cc/claude-sonnet-4-20250514",
    "cx/deepseek-chat",
    "glm/glm-4-plus"
]

prompt = "Explain quantum computing in simple terms"

for model in models:
    response = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}]
    )
    print(f"\n=== {model} ===")
    print(response.choices[0].message.content)
```

## 常见集成模式

### 环境变量

安全地存储凭据:

```bash
# .env file
ROUTER_API_KEY=your-api-key-from-dashboard
ROUTER_BASE_URL=http://localhost:20128/v1
ROUTER_MODEL=cc/claude-sonnet-4-20250514
```

```python
import os
from openai import OpenAI

client = OpenAI(
    api_key=os.getenv("ROUTER_API_KEY"),
    base_url=os.getenv("ROUTER_BASE_URL")
)
```

### 错误处理

```python
from openai import OpenAI, OpenAIError

client = OpenAI(
    api_key="your-api-key",
    base_url="http://localhost:20128/v1"
)

try:
    response = client.chat.completions.create(
        model="cc/claude-sonnet-4-20250514",
        messages=[{"role": "user", "content": "Hello"}]
    )
    print(response.choices[0].message.content)
except OpenAIError as e:
    print(f"Error: {e}")
```

### 重试逻辑

```python
import time
from openai import OpenAI, RateLimitError

client = OpenAI(
    api_key="your-api-key",
    base_url="http://localhost:20128/v1"
)

def chat_with_retry(prompt, max_retries=3):
    for attempt in range(max_retries):
        try:
            response = client.chat.completions.create(
                model="cc/claude-sonnet-4-20250514",
                messages=[{"role": "user", "content": prompt}]
            )
            return response.choices[0].message.content
        except RateLimitError:
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)  # Exponential backoff
            else:
                raise
```

## 故障排除

### 连接问题

**问题:** 无法连接到 9Router
```bash
# 检查 9Router 是否运行
curl http://localhost:20128/health

# 预期响应:
{"status": "ok"}
```

**方案:**
- 确认 9Router 正在运行
- 检查 20128 端口未被阻止
- 确保 base URL 正确(包含 `/v1`)

### 认证错误

**问题:** 401 Unauthorized
```
Error: Invalid API key
```

**方案:**
- 在仪表盘中确认 API key
- 检查 Authorization 头格式:`Bearer your-api-key`
- 确保 API key 中没有多余的空格或换行

### 模型未找到

**问题:** 404 Model not found
```
Error: Model 'cc/claude-opus' not found
```

**方案:**
- 使用精确的模型名(大小写敏感)
- 查看可用模型:`curl http://localhost:20128/v1/models`
- 确认套餐中已启用该模型

### 超时问题

**问题:** 请求超时
```
Error: Request timed out after 30s
```

**方案:**
- 在客户端配置中增大超时
- 时间敏感任务使用更快的模型
- 检查到 9Router 的网络连接

### 速率限制

**问题:** 429 Too Many Requests
```
Error: Rate limit exceeded
```

**方案:**
- 实现指数退避
- 降低请求频率
- 在仪表盘中查看速率限制
- 考虑升级套餐

## 最佳实践

### 安全
- 将 API key 存储在环境变量中
- 绝不将 API key 提交到版本控制
- 云端部署使用 HTTPS
- 定期轮换 API keys

### 性能
- 根据任务复杂度选择合适的模型
- 对重复查询实现缓存
- 长响应使用流式输出
- 尽可能批量请求

### 错误处理
- 始终用 try-catch 块包裹
- 添加带指数退避的重试逻辑
- 记录错误以便调试
- 提供回退机制

### 成本优化
- 简单任务选择高性价比的模型
- 适当时缓存响应
- 在仪表盘监控使用
- 在代码中设置请求上限

## 下一步

- [配置 Cursor](cursor.md) 进行 IDE 集成
- [设置 Continue](continue.md) 用于 VSCode
- [探索 CLI 用法](../cli/basic-usage.md)
- [了解模型选择](../models/overview.md)
- [API 参考](../api/reference.md)
