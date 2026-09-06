function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Interpolates template variables inside a string.
 * Supported variables:
 * - {{apiKey}} / {{token}} -> credentials.apiKey || credentials.accessToken
 * - {{cookie}} -> credentials.cookie || credentials.apiKey
 * - {{model}} -> model name
 * - {{baseUrl}} -> target base URL
 * - {{env.VARIABLE_NAME}} -> process.env.VARIABLE_NAME
 * - {{timestamp}} -> Date.now()
 * - {{uuid}} -> generated UUID/ID
 * - {{custom.KEY}} / {{providerSpecificData.KEY}} -> from providerSpecificData
 */
export function interpolateTemplate(template, context = {}) {
  if (typeof template !== "string") return template;

  return template.replace(/\{\{\s*([a-zA-Z0-9_$.]+)\s*\}\}/g, (match, key) => {
    // Environment variable interpolation
    if (key.startsWith("env.")) {
      const envKey = key.slice(4);
      return process.env[envKey] !== undefined ? String(process.env[envKey]) : "";
    }

    // Provider specific data
    if (key.startsWith("providerSpecificData.") || key.startsWith("custom.")) {
      const subKey = key.replace(/^(providerSpecificData|custom)\./, "");
      const val = context.credentials?.providerSpecificData?.[subKey] ?? context[subKey];
      return val !== undefined && val !== null ? String(val) : "";
    }

    // Common credentials & context keys
    switch (key) {
      case "apiKey":
      case "token":
        return context.credentials?.apiKey || context.credentials?.accessToken || context.apiKey || "";
      case "cookie":
        return context.credentials?.cookie || context.credentials?.providerSpecificData?.cookie || context.cookie || context.credentials?.apiKey || "";
      case "accessToken":
        return context.credentials?.accessToken || context.credentials?.apiKey || "";
      case "model":
        return context.model || "";
      case "baseUrl":
        return context.baseUrl || "";
      case "timestamp":
        return String(Date.now());
      case "uuid":
        return generateId();
      default:
        if (context[key] !== undefined && context[key] !== null) {
          return String(context[key]);
        }
        return match;
    }
  });
}

/**
 * Deeply interpolates template strings in an object or array.
 */
export function interpolateObject(obj, context = {}) {
  if (!obj || typeof obj !== "object") {
    if (typeof obj === "string") {
      return interpolateTemplate(obj, context);
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => interpolateObject(item, context));
  }

  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    const interpolatedKey = interpolateTemplate(k, context);
    result[interpolatedKey] = interpolateObject(v, context);
  }
  return result;
}

/**
 * Compiles and runs a dynamic JS function safely.
 */
export function compileTransformer(codeOrFn, functionName = "transformer") {
  if (typeof codeOrFn === "function") {
    return codeOrFn;
  }

  if (typeof codeOrFn !== "string" || !codeOrFn.trim()) {
    return null;
  }

  const trimmed = codeOrFn.trim();

  try {
    // If it's an arrow function or full function expression
    if (trimmed.startsWith("(") || trimmed.startsWith("function") || trimmed.startsWith("async")) {
      return new Function(`"use strict"; return (${trimmed});`)();
    }

    // If it's a function body
    return new Function("arg1", "arg2", "arg3", "arg4", `"use strict"; ${trimmed}`);
  } catch (err) {
    console.error(`[CustomAdapter] Failed to compile ${functionName}:`, err.message);
    return null;
  }
}

/**
 * Transforms an outbound request using either a JS transformer function
 * or a declarative requestMapping configuration.
 */
export function executeRequestTransformer(adapter, { model, body, headers = {}, credentials = {}, stream = true }) {
  if (!adapter) return { url: null, headers, body };

  const mergedRawHeaders = {
    ...(adapter.headers || {}),
    ...headers,
  };

  const context = {
    model,
    body,
    headers: mergedRawHeaders,
    credentials,
    stream,
    baseUrl: adapter.baseUrl,
    adapter,
  };

  const interpolatedHeaders = interpolateObject(mergedRawHeaders, context);
  context.headers = interpolatedHeaders;

  // 1. Scripted JS transformer
  if (adapter.transformRequest) {
    try {
      const fn = compileTransformer(adapter.transformRequest, "transformRequest");
      if (fn) {
        const transformed = fn(context, { interpolateTemplate, interpolateObject });
        if (transformed && typeof transformed === "object") {
          return {
            url: transformed.url ? interpolateTemplate(transformed.url, context) : null,
            headers: transformed.headers ? interpolateObject(transformed.headers, context) : interpolatedHeaders,
            body: transformed.body !== undefined ? transformed.body : body,
            method: transformed.method || "POST",
          };
        }
      }
    } catch (err) {
      console.error(`[CustomAdapter:${adapter.id}] transformRequest error:`, err);
      throw new Error(`Custom adapter transformRequest failed: ${err.message}`);
    }
  }

  // 2. Declarative request mapping
  if (adapter.requestMapping) {
    const mapping = adapter.requestMapping;
    let targetBody = {};

    if (mapping.bodyTemplate) {
      targetBody = interpolateObject(mapping.bodyTemplate, { ...context, ...body });
    } else {
      // Default declarative field mapping
      targetBody = { ...body };

      if (mapping.modelParam && mapping.modelParam !== "model") {
        targetBody[mapping.modelParam] = body.model;
        delete targetBody.model;
      }

      if (mapping.messagesParam && mapping.messagesParam !== "messages") {
        targetBody[mapping.messagesParam] = body.messages;
        delete targetBody.messages;
      }

      if (mapping.promptParam) {
        // Convert messages array to prompt string
        const messages = Array.isArray(body.messages) ? body.messages : [];
        const prompt = messages.map((m) => `${m.role}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`).join("\n\n");
        targetBody[mapping.promptParam] = prompt;
        delete targetBody.messages;
      }

      if (mapping.streamParam && mapping.streamParam !== "stream") {
        targetBody[mapping.streamParam] = stream;
        delete targetBody.stream;
      }
    }

    const customHeaders = mapping.headers ? interpolateObject({ ...interpolatedHeaders, ...mapping.headers }, context) : interpolatedHeaders;
    const customUrl = mapping.url ? interpolateTemplate(mapping.url, context) : null;

    return {
      url: customUrl,
      headers: customHeaders,
      body: targetBody,
      method: mapping.method || "POST",
    };
  }

  return {
    url: null,
    headers: interpolatedHeaders,
    body,
    method: "POST",
  };
}

/**
 * Extracts a value from a nested object using a dot-path (e.g. "choices.0.message.content").
 */
export function getByPath(obj, path) {
  if (!obj || !path) return undefined;
  const parts = path.replace(/\[(\w+)\]/g, ".$1").replace(/^\./, "").split(".");
  let curr = obj;
  for (const part of parts) {
    if (curr === null || curr === undefined) return undefined;
    curr = curr[part];
  }
  return curr;
}

/**
 * Transforms non-streaming raw response into standard OpenAI completion JSON.
 */
export function executeResponseTransformer(adapter, rawData, state = {}, model = "") {
  if (!adapter) return rawData;

  const context = {
    adapter,
    model,
    state,
  };

  // 1. Scripted JS response transformer
  if (adapter.transformResponse) {
    try {
      const fn = compileTransformer(adapter.transformResponse, "transformResponse");
      if (fn) {
        return fn(rawData, state, context);
      }
    } catch (err) {
      console.error(`[CustomAdapter:${adapter.id}] transformResponse error:`, err);
      throw new Error(`Custom adapter transformResponse failed: ${err.message}`);
    }
  }

  // 2. Declarative response mapping
  if (adapter.responseMapping) {
    const mapping = adapter.responseMapping;
    const content = mapping.contentPath ? getByPath(rawData, mapping.contentPath) : (rawData.content || rawData.text || rawData.response);
    const reasoning = mapping.reasoningPath ? getByPath(rawData, mapping.reasoningPath) : (rawData.reasoning || rawData.thinking);
    const usage = mapping.usagePath ? getByPath(rawData, mapping.usagePath) : rawData.usage;

    return {
      id: `chatcmpl-${generateId ? generateId() : Math.random().toString(36).slice(2)}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: model || adapter.defaultModel || "custom-model",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: content !== undefined ? String(content) : "",
            ...(reasoning ? { reasoning_content: String(reasoning) } : {}),
          },
          finish_reason: "stop",
        },
      ],
      usage: usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
  }

  // If response already looks like OpenAI chat completion, return as is
  if (rawData?.choices && Array.isArray(rawData.choices)) {
    return rawData;
  }

  // Fallback: wrap raw content
  const fallbackText = typeof rawData === "string" ? rawData : (rawData?.text || rawData?.output || rawData?.message || JSON.stringify(rawData));
  return {
    id: `chatcmpl-${generateId ? generateId() : Math.random().toString(36).slice(2)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: model || "custom-model",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: fallbackText,
        },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

/**
 * Transforms an incoming stream chunk or SSE line into OpenAI chat.completion.chunk format.
 * Returns an OpenAI-compatible chunk object or null if chunk is ignored/empty.
 */
export function executeStreamChunkTransformer(adapter, rawChunk, state = {}, model = "") {
  if (!adapter) return null;

  const context = {
    adapter,
    model,
    state,
  };

  // 1. Scripted JS stream chunk transformer
  if (adapter.transformStreamChunk) {
    try {
      const fn = compileTransformer(adapter.transformStreamChunk, "transformStreamChunk");
      if (fn) {
        return fn(rawChunk, state, context);
      }
    } catch (err) {
      console.error(`[CustomAdapter:${adapter.id}] transformStreamChunk error:`, err);
      return null;
    }
  }

  // 2. Declarative SSE / NDJSON / Text chunk processing
  if (typeof rawChunk === "string") {
    const trimmed = rawChunk.trim();
    if (!trimmed || trimmed === "[DONE]") return null;

    let parsed = null;
    if (trimmed.startsWith("data:")) {
      const dataContent = trimmed.slice(5).trim();
      if (dataContent === "[DONE]") return null;
      try {
        parsed = JSON.parse(dataContent);
      } catch {
        parsed = { content: dataContent };
      }
    } else {
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        parsed = { content: trimmed };
      }
    }

    if (parsed) {
      // If already OpenAI chunk format
      if (parsed.choices && Array.isArray(parsed.choices)) {
        return parsed;
      }

      // Check declarative mapping
      const deltaText = adapter.streamMapping?.deltaPath
        ? getByPath(parsed, adapter.streamMapping.deltaPath)
        : (parsed.delta || parsed.text || parsed.content || parsed.response || parsed.token);

      const reasoningText = adapter.streamMapping?.reasoningPath
        ? getByPath(parsed, adapter.streamMapping.reasoningPath)
        : (parsed.reasoning_content || parsed.reasoning || parsed.thinking);

      if (deltaText !== undefined || reasoningText !== undefined) {
        return {
          id: `chatcmpl-${state.id || "stream"}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: model || "custom-model",
          choices: [
            {
              index: 0,
              delta: {
                ...(deltaText !== undefined ? { content: String(deltaText) } : {}),
                ...(reasoningText !== undefined ? { reasoning_content: String(reasoningText) } : {}),
              },
              finish_reason: null,
            },
          ],
        };
      }
    }
  }

  if (typeof rawChunk === "object" && rawChunk !== null) {
    if (rawChunk.choices && Array.isArray(rawChunk.choices)) {
      return rawChunk;
    }
  }

  return null;
}
