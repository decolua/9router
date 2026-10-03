import { BaseExecutor } from "./base.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { dbg } from "../utils/debugLog.js";
import { FETCH_CONNECT_TIMEOUT_MS, HTTP_STATUS } from "../config/runtimeConfig.js";
import { SSE_DONE } from "../utils/sseConstants.js";
import {
  interpolateTemplate,
  interpolateObject,
  executeRequestTransformer,
  executeResponseTransformer,
  executeStreamChunkTransformer,
} from "../custom-adapters/transformer.js";
import { getCustomAdapter } from "../custom-adapters/loader.js";

/**
 * Wraps custom streaming response into standard OpenAI SSE chunks (`data: {...}\n\n`).
 */
async function wrapCustomAdapterSSE(response, adapter, model) {
  if (!response.ok || !response.body) return response;

  const decoder = new TextDecoder("utf-8");
  const encoder = new TextEncoder();
  const reader = response.body.getReader();
  const state = { id: Date.now(), model, lineCount: 0 };

  let buffer = "";
  let doneEmitted = false;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            if (!doneEmitted) {
              controller.enqueue(encoder.encode(SSE_DONE));
              doneEmitted = true;
            }
            controller.close();
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            if (trimmed === "data: [DONE]" || trimmed === "[DONE]") {
              controller.enqueue(encoder.encode(SSE_DONE));
              doneEmitted = true;
              controller.close();
              await reader.cancel().catch(() => {});
              return;
            }

            const transformedChunk = executeStreamChunkTransformer(adapter, line, state, model);
            if (transformedChunk) {
              const chunkStr = typeof transformedChunk === "string" ? transformedChunk : JSON.stringify(transformedChunk);
              controller.enqueue(encoder.encode(`data: ${chunkStr}\n\n`));
            }
          }
        }
      } catch (err) {
        if (!doneEmitted) {
          controller.error(err);
        }
      } finally {
        reader.releaseLock();
      }
    },
    async cancel() {
      await reader.cancel().catch(() => {});
    },
  });

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

/**
 * CustomAdapterExecutor executes chat requests against custom provider endpoints
 * using declarative mappings or JS transformation scripts.
 */
export class CustomAdapterExecutor extends BaseExecutor {
  constructor(provider, config = null, adapter = null) {
    const resolvedAdapter = adapter || config?.customAdapter || getCustomAdapter(provider);
    const resolvedConfig = config || {
      baseUrl: resolvedAdapter?.baseUrl || "",
      headers: resolvedAdapter?.headers || {},
    };
    super(provider, resolvedConfig);
    this.adapter = resolvedAdapter;
  }

  getAdapter() {
    if (!this.adapter) {
      this.adapter = getCustomAdapter(this.provider);
    }
    return this.adapter;
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const adapter = this.getAdapter();
    const context = {
      model,
      stream,
      credentials,
      apiKey: credentials?.apiKey || credentials?.accessToken,
      baseUrl: adapter?.baseUrl || this.config.baseUrl,
    };

    if (adapter?.requestMapping?.url) {
      return interpolateTemplate(adapter.requestMapping.url, context);
    }

    const rawUrl = adapter?.baseUrl || this.config.baseUrl || "";
    return interpolateTemplate(rawUrl, context);
  }

  buildHeaders(credentials, stream = true, url = "", model = "") {
    const adapter = this.getAdapter();
    const baseHeaders = {
      "Content-Type": "application/json",
      ...(adapter?.headers || this.config.headers || {}),
    };

    const context = {
      model,
      stream,
      url,
      credentials,
      apiKey: credentials?.apiKey || credentials?.accessToken || "",
      cookie: credentials?.cookie || credentials?.providerSpecificData?.cookie || credentials?.apiKey || "",
      accessToken: credentials?.accessToken || credentials?.apiKey || "",
      env: process.env,
    };

    const headers = interpolateObject(baseHeaders, context);

    // Apply default auth scheme if not explicitly defined in headers
    const authType = adapter?.authType || "apikey";
    if (authType === "bearer" && !headers["Authorization"] && !headers["authorization"]) {
      const token = credentials?.apiKey || credentials?.accessToken;
      if (token) headers["Authorization"] = `Bearer ${token}`;
    } else if (authType === "apikey" && !headers["x-api-key"] && !headers["X-API-Key"]) {
      const key = credentials?.apiKey || credentials?.accessToken;
      if (key) headers["x-api-key"] = key;
    } else if (authType === "cookie" && !headers["Cookie"] && !headers["cookie"]) {
      const cookieVal = credentials?.providerSpecificData?.cookie || credentials?.apiKey;
      if (cookieVal) headers["Cookie"] = cookieVal;
    }

    if (stream) {
      headers["Accept"] = "text/event-stream, application/json";
    }

    return headers;
  }

  transformRequest(model, body, stream, credentials) {
    const adapter = this.getAdapter();
    const transformed = executeRequestTransformer(adapter, {
      model,
      body,
      headers: this.buildHeaders(credentials, stream, "", model),
      credentials,
      stream,
    });
    return transformed.body;
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const adapter = this.getAdapter();
    let url = this.buildUrl(model, stream, 0, credentials);
    let headers = this.buildHeaders(credentials, stream, url, model);
    let method = "POST";
    let transformedBody = body;

    // Run request transformer
    const reqTransform = executeRequestTransformer(adapter, {
      model,
      body,
      headers,
      credentials,
      stream,
    });

    if (reqTransform.url) url = reqTransform.url;
    if (reqTransform.headers) headers = reqTransform.headers;
    if (reqTransform.method) method = reqTransform.method;
    transformedBody = reqTransform.body;

    const connectCtrl = new AbortController();
    const timeoutMs = this.config?.timeoutMs || FETCH_CONNECT_TIMEOUT_MS;
    const connectTimer = setTimeout(() => connectCtrl.abort(new Error("fetch connect timeout")), timeoutMs);
    const mergedSignal = signal ? AbortSignal.any([signal, connectCtrl.signal]) : connectCtrl.signal;

    try {
      const bodyStr = typeof transformedBody === "string" ? transformedBody : JSON.stringify(transformedBody);
      const fetchT0 = Date.now();
      dbg("FETCH", `[CUSTOM-ADAPTER:${this.provider.toUpperCase()}] → ${url} | method=${method} | body=${bodyStr.length}B`);

      const fetchOptions = {
        method,
        headers,
        signal: mergedSignal,
      };

      if (method.toUpperCase() !== "GET" && method.toUpperCase() !== "HEAD") {
        fetchOptions.body = bodyStr;
      }

      const response = await proxyAwareFetch(url, fetchOptions, proxyOptions);
      clearTimeout(connectTimer);

      const ct = response.headers?.get?.("content-type") || "";
      const cl = response.headers?.get?.("content-length") || "?";
      dbg("FETCH", `[CUSTOM-ADAPTER:${this.provider.toUpperCase()}] ← ${response.status} | ttft=${Date.now() - fetchT0}ms | ct=${ct} | cl=${cl}`);

      if (!response.ok) {
        return { response, url, headers, transformedBody };
      }

      // If streaming response, wrap SSE
      if (stream) {
        const wrappedResponse = await wrapCustomAdapterSSE(response, adapter, model);
        return { response: wrappedResponse, url, headers, transformedBody };
      }

      // If non-streaming response, transform JSON output
      const rawText = await response.text();
      let rawJson = null;
      try {
        rawJson = JSON.parse(rawText);
      } catch {
        rawJson = { text: rawText };
      }

      const transformedOutput = executeResponseTransformer(adapter, rawJson, {}, model);
      const transformedResponse = new Response(JSON.stringify(transformedOutput), {
        status: response.status,
        statusText: response.statusText,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });

      return { response: transformedResponse, url, headers, transformedBody };
    } catch (err) {
      clearTimeout(connectTimer);
      throw err;
    }
  }
}

export default CustomAdapterExecutor;
