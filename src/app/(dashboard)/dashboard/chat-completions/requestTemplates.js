export const CHAT_COMPLETION_ENDPOINTS = [
  {
    id: "root",
    label: "GET /api/v1",
    method: "GET",
    path: "/api/v1",
  },
  {
    id: "models",
    label: "GET /api/v1/models",
    method: "GET",
    path: "/api/v1/models",
  },
  {
    id: "chat-completions",
    label: "POST /api/v1/chat/completions",
    method: "POST",
    path: "/api/v1/chat/completions",
  },
  {
    id: "messages",
    label: "POST /api/v1/messages",
    method: "POST",
    path: "/api/v1/messages",
  },
  {
    id: "messages-count-tokens",
    label: "POST /api/v1/messages/count_tokens",
    method: "POST",
    path: "/api/v1/messages/count_tokens",
  },
  {
    id: "responses",
    label: "POST /api/v1/responses",
    method: "POST",
    path: "/api/v1/responses",
  }
];

export function getEndpointConfig(endpointId) {
  return CHAT_COMPLETION_ENDPOINTS.find((item) => item.id === endpointId) || CHAT_COMPLETION_ENDPOINTS[0];
}

export function createRequestTemplate(endpointId, comboName) {
  const model = comboName || "";

  switch (endpointId) {
    case "messages":
      return {
        model,
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: "Hello. Please introduce yourself briefly.",
          },
        ],
        stream: false,
      };
    case "messages-count-tokens":
      return {
        model,
        messages: [
          {
            role: "user",
            content: "Count tokens for this combo request.",
          },
        ],
      };
    case "responses":
      return {
        model,
        input: "Hello. Please introduce yourself briefly.",
      };
    case "embeddings":
      return {
        model,
        input: "Hello from 9Router.",
      };
    case "chat-completions":
      return {
        model,
        messages: [
          {
            role: "user",
            content: "Hello. Please introduce yourself briefly.",
          },
        ],
        stream: false,
      };
    default:
      return {};
  }
}

export function stringifyBody(value) {
  return JSON.stringify(value, null, 2);
}
