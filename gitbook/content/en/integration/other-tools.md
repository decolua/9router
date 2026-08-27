# Other Tools Integration

9Router provides standard OpenAI-compatible and Anthropic-compatible endpoints that work with any AI tool, SDK, or script.

---

## Endpoint Specifications

- **OpenAI-compatible Base URL**: `http://localhost:20128/v1`
- **Anthropic-compatible Base URL**: `http://localhost:20128/v1`
- **Default API Key**: `sk_9router` (ignored unless `REQUIRE_API_KEY=true`)

---

## Python OpenAI SDK Example

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:20128/v1",
    api_key="sk_9router",
)

response = client.chat.completions.create(
    model="cc/claude-opus-4-7",
    messages=[
        {"role": "user", "content": "Write a quicksort in Python"}
    ],
)
print(response.choices[0].message.content)
```

---

## cURL Example

```bash
curl http://localhost:20128/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk_9router" \
  -d '{
    "model": "kr/claude-sonnet-4.5",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```
