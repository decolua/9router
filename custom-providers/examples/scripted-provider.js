/**
 * Example Scripted Custom Provider Adapter for 9router
 */
export default {
  id: "custom-example-scripted",
  name: "Scripted Example Provider",
  prefix: "demo-scripted",
  baseUrl: "https://api.example.com/v1/generate",
  icon: "code",
  color: "#ec4899",
  category: "custom",
  authType: "cookie",
  headers: {
    "Cookie": "session_id={{cookie}}",
    "X-Client": "9router-custom-adapter",
  },
  models: [
    { "id": "scripted-fast", "name": "Scripted Fast Model" },
    { "id": "scripted-reasoning", "name": "Scripted Reasoning Model" },
  ],

  // 1. Outgoing Request Transformer
  transformRequest: (context) => {
    const { model, body, headers, credentials } = context;
    const lastUserMessage = Array.isArray(body.messages)
      ? body.messages.filter((m) => m.role === "user").pop()
      : null;

    return {
      url: context.baseUrl,
      headers: {
        ...headers,
        "X-Custom-Auth": credentials.apiKey || "",
      },
      body: {
        prompt: lastUserMessage ? lastUserMessage.content : "",
        model_name: model,
        stream: context.stream,
      },
    };
  },

  // 2. Non-Streaming Response Transformer
  transformResponse: (rawJson, state, context) => {
    const outputText = rawJson.output || rawJson.response || rawJson.text || "";
    return {
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: context.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: outputText,
          },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
  },

  // 3. Streaming Chunk Transformer (SSE Line -> OpenAI Completion Chunk)
  transformStreamChunk: (chunk, state, context) => {
    if (typeof chunk === "string" && chunk.startsWith("data:")) {
      const data = chunk.slice(5).trim();
      if (data === "[DONE]") return null;
      try {
        const parsed = JSON.parse(data);
        return {
          id: `chatcmpl-${state.id || "stream"}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: context.model,
          choices: [
            {
              index: 0,
              delta: {
                content: parsed.delta || parsed.token || parsed.text || "",
              },
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
