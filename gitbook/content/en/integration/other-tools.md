# Other Tools Integration

9Router is compatible with any tool that supports the OpenAI API format. This guide covers generic integration patterns for various tools and custom applications.

## Overview

9Router provides an OpenAI-compatible API endpoint that works with:
- Custom scripts and applications
- API clients and testing tools
- CLI tools and utilities
- Third-party integrations
- Development frameworks

## Generic Setup Pattern

Any OpenAI-compatible tool can connect to 9Router using these settings:

**Local 9Router:**
```
Base URL: http://localhost:20128/v1
API Key: your-api-key-from-dashboard
Model: any 9Router model (cc/*, cx/*, glm/*, etc.)
```

**Cloud 9Router:**
```
Base URL: https://9router.com/v1
API Key: your-api-key-from-dashboard
Model: any 9Router model (cc/*, cx/*, glm/*, etc.)
```

## Available Models

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

## Integration Examples

### Python with OpenAI SDK

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

### Node.js with OpenAI SDK

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

### cURL Command

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

### LangChain Integration

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

### LlamaIndex Integration

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

## Custom Script Examples

### Batch Processing Script

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

### Streaming Response Handler

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

### Multi-Model Comparison

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

## Common Integration Patterns

### Environment Variables

Store credentials securely:

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

### Error Handling

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

### Retry Logic

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

### Connection Issues

**Problem:** Cannot connect to 9Router
```bash
# Check if 9Router is running
curl http://localhost:20128/health

# Expected response:
{"status": "ok"}
```

**Solution:**
- Verify 9Router is running
- Check port 20128 is not blocked
- Ensure correct base URL (include `/v1`)

### Authentication Errors

**Problem:** 401 Unauthorized
```
Error: Invalid API key
```

**Solution:**
- Verify API key from dashboard
- Check Authorization header format: `Bearer your-api-key`
- Ensure no extra spaces or newlines in API key

### Model Not Found

**Problem:** 404 Model not found
```
Error: Model 'cc/claude-opus' not found
```

**Solution:**
- Use exact model name (case-sensitive)
- Check available models: `curl http://localhost:20128/v1/models`
- Verify model is enabled in your plan

### Timeout Issues

**Problem:** Request timeout
```
Error: Request timed out after 30s
```

**Solution:**
- Increase timeout in client configuration
- Use faster models for time-sensitive tasks
- Check network connection to 9Router

### Rate Limiting

**Problem:** 429 Too Many Requests
```
Error: Rate limit exceeded
```

**Solution:**
- Implement exponential backoff
- Reduce request frequency
- Check rate limits in dashboard
- Consider upgrading plan

## Best Practices

### Security
- Store API keys in environment variables
- Never commit API keys to version control
- Use HTTPS for cloud deployments
- Rotate API keys regularly

### Performance
- Use appropriate models for task complexity
- Implement caching for repeated queries
- Use streaming for long responses
- Batch requests when possible

### Error Handling
- Always implement try-catch blocks
- Add retry logic with exponential backoff
- Log errors for debugging
- Provide fallback mechanisms

### Cost Optimization
- Choose cost-effective models for simple tasks
- Cache responses when appropriate
- Monitor usage in dashboard
- Set request limits in code

## Next Steps

- [Configure Cursor](cursor.md) for IDE integration
- [Set up Continue](continue.md) for VSCode
- [Explore CLI usage](../cli/basic-usage.md)
- [Learn about model selection](../models/overview.md)
- [API Reference](../api/reference.md)
