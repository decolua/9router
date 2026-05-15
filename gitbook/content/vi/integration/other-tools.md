# Tích hợp các Công cụ khác

9Router tương thích với mọi công cụ hỗ trợ format API OpenAI. Hướng dẫn này bao gồm pattern tích hợp tổng quát cho nhiều công cụ và ứng dụng tùy chỉnh.

## Tổng quan

9Router cung cấp API endpoint tương thích OpenAI hoạt động với:
- Script và ứng dụng tùy chỉnh
- API client và công cụ test
- Công cụ CLI và utility
- Tích hợp bên thứ ba
- Framework phát triển

## Pattern Setup Tổng quát

Mọi công cụ tương thích OpenAI có thể kết nối đến 9Router bằng các cài đặt sau:

**9Router cục bộ:**
```
Base URL: http://localhost:20128/v1
API Key: your-api-key-from-dashboard
Model: any 9Router model (cc/*, cx/*, glm/*, etc.)
```

**9Router cloud:**
```
Base URL: https://9router.com/v1
API Key: your-api-key-from-dashboard
Model: any 9Router model (cc/*, cx/*, glm/*, etc.)
```

## Model có sẵn

### Claude Models (Anthropic)
- `cc/claude-opus-4-5-20251101`
- `cc/claude-sonnet-4-20250514`
- `cc/claude-haiku-4-20250514`

### DeepSeek Models
- `cx/deepseek-chat`
- `cx/deepseek-reasoner`

### GLM Models (Zhipu AI)
- `glm/glm-4-plus`
- `glm/glm-4-flash`

## Ví dụ Tích hợp

### Python với OpenAI SDK

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

### Node.js với OpenAI SDK

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

### Lệnh cURL

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

### HTTP Client (Postman, Insomnia)

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

### Tích hợp LangChain

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

### Tích hợp LlamaIndex

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

## Ví dụ Script Tùy chỉnh

### Script Xử lý Batch

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

### Xử lý Streaming Response

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

### So sánh Nhiều Model

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

## Pattern Tích hợp Phổ biến

### Biến môi trường

Lưu credentials an toàn:

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

### Xử lý Lỗi

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

### Logic Retry

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

## Troubleshooting

### Vấn đề Connection

**Vấn đề:** Không kết nối được đến 9Router
```bash
# Check if 9Router is running
curl http://localhost:20128/health

# Expected response:
{"status": "ok"}
```

**Giải pháp:**
- Xác minh 9Router đang chạy
- Kiểm tra port 20128 không bị chặn
- Đảm bảo base URL đúng (bao gồm `/v1`)

### Lỗi Xác thực

**Vấn đề:** 401 Unauthorized
```
Error: Invalid API key
```

**Giải pháp:**
- Xác minh API key từ dashboard
- Kiểm tra format header Authorization: `Bearer your-api-key`
- Đảm bảo không có khoảng trắng hoặc xuống dòng thừa trong API key

### Model Not Found

**Vấn đề:** 404 Model not found
```
Error: Model 'cc/claude-opus' not found
```

**Giải pháp:**
- Dùng tên model chính xác (case-sensitive)
- Kiểm tra model có sẵn: `curl http://localhost:20128/v1/models`
- Xác minh model được bật trong plan của bạn

### Vấn đề Timeout

**Vấn đề:** Request timeout
```
Error: Request timed out after 30s
```

**Giải pháp:**
- Tăng timeout trong cấu hình client
- Dùng model nhanh hơn cho task nhạy cảm về thời gian
- Kiểm tra kết nối network đến 9Router

### Rate Limiting

**Vấn đề:** 429 Too Many Requests
```
Error: Rate limit exceeded
```

**Giải pháp:**
- Triển khai exponential backoff
- Giảm tần suất request
- Kiểm tra rate limit trong dashboard
- Cân nhắc nâng cấp plan

## Best Practices

### Bảo mật
- Lưu API key trong biến môi trường
- Không bao giờ commit API key vào version control
- Dùng HTTPS cho cloud deployment
- Xoay API key định kỳ

### Hiệu năng
- Dùng model phù hợp với độ phức tạp task
- Triển khai caching cho query lặp lại
- Dùng streaming cho phản hồi dài
- Batch request khi có thể

### Xử lý Lỗi
- Luôn triển khai try-catch block
- Thêm logic retry với exponential backoff
- Log lỗi để debug
- Cung cấp cơ chế fallback

### Tối ưu Chi phí
- Chọn model tiết kiệm chi phí cho task đơn giản
- Cache phản hồi khi phù hợp
- Theo dõi usage trong dashboard
- Đặt giới hạn request trong code

## Bước tiếp theo

- [Cấu hình Cursor](cursor.md) cho tích hợp IDE
- [Setup Continue](continue.md) cho VSCode
- [Khám phá CLI usage](../cli/basic-usage.md)
- [Tìm hiểu về chọn model](../models/overview.md)
- [API Reference](../api/reference.md)
