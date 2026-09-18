# Custom Provider Adapters for 9router

Custom Provider Adapters allow you to integrate unofficial web APIs, private model microservices, and custom upstream endpoints without modifying 9router's core codebase.

Adapters can be configured directly from the **Dashboard UI (`/dashboard/custom-adapters`)** or by adding `.json` and `.js` definition files into this `custom-providers/` directory.

---

## Features

- **Declarative JSON Adapters**: Map request and response payloads with simple configuration without writing code.
- **Scripted JS/TS Transformers**: Full control over HTTP request construction, custom headers/cookies, non-standard response bodies, and custom SSE / NDJSON streaming frames.
- **Hot Reloading**: Files added, modified, or removed in `custom-providers/` are automatically reloaded without restarting 9router.
- **Template Variables**: Deep interpolation of credentials, models, cookies, and environment variables.
- **Full Model Prefixing**: Access custom models via `your-prefix/model-name` through OpenAI-compatible `/v1/chat/completions` or Anthropic `/v1/messages`.

---

## Template Variables

The following placeholders are supported in URLs, headers, and request templates:

| Variable | Description |
| :--- | :--- |
| `{{apiKey}}` | The API key or token configured on the connection |
| `{{cookie}}` | Session cookie configured on the connection |
| `{{model}}` | Model ID requested by the client |
| `{{baseUrl}}` | Base URL configured for this adapter |
| `{{env.VAR_NAME}}` | System environment variable (e.g. `{{env.UPSTREAM_TOKEN}}`) |
| `{{timestamp}}` | Current UNIX timestamp in milliseconds |
| `{{uuid}}` | Unique UUID string |

---

## 1. Declarative Adapter Example (`.json`)

Create a file named `my-gateway.json` in `custom-providers/`:

```json
{
  "id": "custom-my-gateway",
  "name": "My Gateway",
  "prefix": "my-gateway",
  "baseUrl": "https://api.my-endpoint.com/v1/chat",
  "authType": "apikey",
  "headers": {
    "X-Api-Key": "{{apiKey}}",
    "X-Custom-Client": "9router"
  },
  "requestMapping": {
    "promptParam": "prompt",
    "modelParam": "engine"
  },
  "responseMapping": {
    "contentPath": "data.output.text",
    "reasoningPath": "data.thinking"
  },
  "models": [
    { "id": "llama-3-8b", "name": "Llama 3 8B" },
    { "id": "mistral-large", "name": "Mistral Large" }
  ]
}
```

---

## 2. Scripted Transformer Example (`.js` / `.mjs`)

Create a file named `my-scripted-adapter.js` in `custom-providers/`:

```javascript
export default {
  id: "custom-web-ai",
  name: "Unofficial Web AI",
  prefix: "web-ai",
  baseUrl: "https://unofficial.service.local/api/chat",
  authType: "cookie",
  headers: {
    "Cookie": "session={{cookie}}",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
  },
  models: [
    { "id": "web-pro", "name": "Web Pro Model" }
  ],

  // 1. Transform outgoing request payload
  transformRequest: (context) => {
    const { model, body, headers, credentials } = context;
    const lastUser = body.messages.filter(m => m.role === "user").pop();

    return {
      url: context.baseUrl,
      headers: {
        ...headers,
        "X-Request-Id": "req-" + Date.now(),
      },
      body: {
        query: lastUser ? lastUser.content : "",
        model_name: model,
        stream_mode: context.stream,
      },
    };
  },

  // 2. Transform non-streaming raw response
  transformResponse: (rawJson, state, context) => {
    return {
      id: "chatcmpl-" + Date.now(),
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: context.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: rawJson.answer || rawJson.result || "",
          },
          finish_reason: "stop",
        },
      ],
    };
  },

  // 3. Transform streaming chunks (SSE / NDJSON lines)
  transformStreamChunk: (chunk, state, context) => {
    if (typeof chunk === "string" && chunk.startsWith("data:")) {
      const data = chunk.slice(5).trim();
      if (data === "[DONE]") return null;
      try {
        const parsed = JSON.parse(data);
        return {
          id: "chatcmpl-" + (state.id || "stream"),
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: context.model,
          choices: [
            {
              index: 0,
              delta: { content: parsed.token || parsed.text || "" },
              finish_reason: null,
            },
          ],
        };
      } catch {
        return null;
      }
    }
    return null;
  },
};
```
