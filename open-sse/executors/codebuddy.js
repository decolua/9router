import { randomUUID } from "crypto";
import { gzipSync } from "zlib";
import { DefaultExecutor } from "./default.js";

const SYSTEM_PROMPT = "You are CodeBuddy Code.";
const ALLOWED_FIELDS = [
  "temperature", "top_p", "presence_penalty", "frequency_penalty", "stop",
  "tool_choice", "parallel_tool_calls", "response_format",
];

function requestId() {
  return randomUUID().replace(/-/g, "");
}

function truncateMiddle(text, maxChars, label) {
  if (typeof text !== "string" || text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.75);
  const tail = Math.max(0, maxChars - head - label.length - 12);
  return `${text.slice(0, head)}\n\n[${label}]\n\n${text.slice(-tail)}`;
}

function sanitizeSchema(schema) {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(sanitizeSchema);
  const next = { ...schema };
  if (typeof next.description === "string") {
    next.description = truncateMiddle(next.description, 500, "schema description truncated");
  }
  for (const key of Object.keys(next)) {
    if (key !== "description" && next[key] && typeof next[key] === "object") next[key] = sanitizeSchema(next[key]);
  }
  return next;
}

function normalizeTools(tools) {
  if (!Array.isArray(tools)) return tools;
  return tools.map((tool) => {
    if (!tool || typeof tool !== "object") return tool;
    if (tool.function && typeof tool.function === "object") {
      return { ...tool, function: {
        ...tool.function,
        description: truncateMiddle(tool.function.description || "", 1200, "tool description truncated"),
        parameters: sanitizeSchema(tool.function.parameters),
      } };
    }
    return {
      ...tool,
      description: truncateMiddle(tool.description || "", 1200, "tool description truncated"),
      input_schema: sanitizeSchema(tool.input_schema),
      parameters: sanitizeSchema(tool.parameters),
    };
  });
}

function normalizeMessages(messages) {
  const result = [{ role: "system", content: SYSTEM_PROMPT }];
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message || typeof message !== "object" || ["system", "developer"].includes(message.role)) continue;
    if (message.role === "user" && typeof message.content === "string") {
      result.push({ ...message, content: [{ type: "text", text: message.content }] });
    } else {
      result.push({ ...message });
    }
  }
  return result;
}

export class CodeBuddyGlobalExecutor extends DefaultExecutor {
  constructor() {
    super("codebuddy");
  }

  transformRequest(model, body) {
    const source = super.transformRequest(model, body);
    const transformed = { model, messages: normalizeMessages(source.messages), stream: true };
    for (const field of ALLOWED_FIELDS) {
      if (source[field] !== undefined) transformed[field] = source[field];
    }
    if (Array.isArray(source.tools)) transformed.tools = normalizeTools(source.tools);
    const maxTokens = Number(source.max_tokens ?? source.max_completion_tokens);
    if (Number.isFinite(maxTokens) && maxTokens > 0) transformed.max_tokens = Math.max(maxTokens, 16);
    return transformed;
  }

  buildHeaders(credentials) {
    const headers = super.buildHeaders(credentials, true);
    const reqId = requestId();
    const conversationId = requestId();
    Object.assign(headers, {
      "Content-Type": "application/json; charset=utf-8",
      "X-Stainless-Runtime": "node",
      "X-Stainless-Lang": "js",
      "X-Stainless-Helper-Method": "stream",
      "X-Stainless-Retry-Count": "0",
      "X-Request-ID": reqId,
      "X-Conversation-ID": conversationId,
      "X-Conversation-Request-ID": conversationId,
      "X-Conversation-Message-ID": reqId,
      "X-Agent-Intent": "craft",
      "X-Private-Data": "false",
    });
    if (credentials.providerSpecificData?.domain) headers["X-Domain"] = credentials.providerSpecificData.domain;
    return headers;
  }

  prepareRequestBody(transformedBody, headers) {
    headers["Content-Encoding"] = "gzip";
    return gzipSync(JSON.stringify(transformedBody));
  }
}

export default CodeBuddyGlobalExecutor;
