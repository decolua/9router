/**
 * Wrap chat-completions endpoints (with built-in web search) into the unified
 * /v1/search response format. Supports gemini, openai, xai, kimi, minimax, perplexity.
 */
import { PROVIDER_MEDIA } from "../../providers/index.js";

// Default search model + endpoint derive from registry searchViaChat (single source)
const searchModel = (id) => PROVIDER_MEDIA[id]?.searchViaChat?.defaultModel;
const searchEndpoint = (id, model) =>
  (PROVIDER_MEDIA[id]?.searchViaChat?.endpoint || "").replace("{model}", model || "");

const REQUEST_TIMEOUT_MS = 60000;
const DEFAULT_MAX_RESULTS = 10;

/**
 * Normalize a citation entry into the unified result shape.
 * @param {{url:string, title?:string, snippet?:string}} c
 * @param {number} index
 * @param {string} provider
 * @param {string} retrievedAt
 */
function toResult(c, index, provider, retrievedAt) {
  return {
    title: c.title || "",
    url: c.url,
    snippet: c.snippet || "",
    position: index + 1,
    score: null,
    published_at: null,
    favicon_url: null,
    content: c.content || c.snippet || null,
    metadata: {},
    citation: { provider, retrieved_at: retrievedAt, rank: index + 1 },
    provider_raw: null
  };
}

/** Coerce a citation that might be a raw URL string or an object. */
function normalizeCitation(c) {
  if (!c) return null;
  if (typeof c === "string") return { url: c };
  if (typeof c === "object" && c.url) return c;
  return null;
}

/**
 * Provider-specific configuration map. All providers must implement:
 * { endpoint, defaultModel, buildBody, buildHeaders, extractAnswer }
 */
const CHAT_SEARCH_CONFIG = {
  gemini: {
    endpoint: (model) => searchEndpoint("gemini", model),
    buildBody: (query) => ({
      contents: [{ role: "user", parts: [{ text: query }] }],
      tools: [{ google_search: {} }]
    }),
    buildHeaders: (token) => ({
      "Content-Type": "application/json",
      "x-goog-api-key": token
    }),
    extractAnswer: (data) => {
      const candidate = data?.candidates?.[0];
      const parts = candidate?.content?.parts || [];
      const text = parts.map((p) => p?.text || "").filter(Boolean).join("");
      const chunks = candidate?.groundingMetadata?.groundingChunks || [];
      const citations = chunks
        .map((ch) => ch?.web)
        .filter(Boolean)
        .map((w) => ({ url: w.uri || w.url, title: w.title || "" }))
        .filter((c) => c.url);
      const tokens = data?.usageMetadata?.totalTokenCount || 0;
      return { text, citations, tokens };
    }
  },


  antigravity: {
    endpoint: () => searchEndpoint("antigravity"),
    buildBody: (query, model, credentials) => {
      // For search/grounding via v1internal:generateContent, use base model names
      // (tiered names only work on streamGenerateContent)
      const AG_MODEL_MAP = {
        "gemini-3.7-flash-high": "gemini-2.5-flash",
        "gemini-3.7-flash-medium": "gemini-2.5-flash",
        "gemini-3.7-flash-low": "gemini-2.5-flash",
        "gemini-3.6-flash-high": "gemini-2.5-flash",
        "gemini-3.6-flash-medium": "gemini-2.5-flash",
        "gemini-3.6-flash-low": "gemini-2.5-flash",
        "gemini-3.5-flash-high": "gemini-2.5-flash",
        "gemini-3-flash-agent": "gemini-2.5-flash",
        "gemini-2.5-flash": "gemini-2.5-flash",
        "gemini-2.5-pro": "gemini-2.5-pro",
      };
      const upstreamModel = AG_MODEL_MAP[model] || model || "gemini-2.5-flash";
      return {
        project: credentials?.projectId || "unknown",
        model: upstreamModel,
      userAgent: "antigravity",
      requestType: "search",
      request: {
        contents: [{ role: "user", parts: [{ text: query }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: { temperature: 1.0, maxOutputTokens: 8192 }
      }
    };
    },
    buildHeaders: (token) => ({
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "User-Agent": "antigravity-ide/1.101.0"
    }),
    extractAnswer: (data) => {
      // Antigravity wraps response in {response: {...}}
      const response = data?.response || data;
      const candidate = response?.candidates?.[0];
      const parts = candidate?.content?.parts || [];
      const text = parts.map(p => p?.text || "").filter(Boolean).join("");
      const gm = candidate?.groundingMetadata || {};
      const chunks = gm.groundingChunks || [];
      const supports = gm.groundingSupports || [];

      // Build two maps per chunk: raw snippets (short) and expanded context (long)
      const rawSnippetsByChunk = {};
      const expandedByChunk = {};
      for (const s of supports) {
        const seg = s?.segment;
        const rawText = seg?.text || "";
        let expandedText = rawText;

        if (seg && typeof seg.startIndex === "number" && typeof seg.endIndex === "number" && text) {
          // Expanded: grab surrounding paragraph context
          const start = Math.max(0, seg.startIndex - 150);
          const end = Math.min(text.length, seg.endIndex + 250);
          let exp = text.slice(start, end).trim();
          if (start > 0) exp = "..." + exp.replace(/^[^\s]+/, "");
          if (end < text.length) exp = exp.replace(/[^\s]+$/, "") + "...";
          expandedText = exp;
        }

        for (const idx of (s?.groundingChunkIndices || [])) {
          if (!rawSnippetsByChunk[idx]) rawSnippetsByChunk[idx] = [];
          if (!expandedByChunk[idx]) expandedByChunk[idx] = [];
          if (rawText && !rawSnippetsByChunk[idx].includes(rawText)) {
            rawSnippetsByChunk[idx].push(rawText);
          }
          if (expandedText && !expandedByChunk[idx].includes(expandedText)) {
            expandedByChunk[idx].push(expandedText);
          }
        }
      }

      const citations = chunks
        .map((ch, i) => {
          const w = ch?.web;
          if (!w) return null;
          const rawPieces = rawSnippetsByChunk[i] || [];
          const expPieces = expandedByChunk[i] || [];
          const snippet = rawPieces.length > 0 ? rawPieces.join(" | ") : (w.title || "");
          const content = expPieces.length > 0 ? expPieces.join("\n\n") : snippet;
          return {
            url: w.uri || w.url || "",
            title: w.title || "",
            snippet,
            content
          };
        })
        .filter(c => c && c.url);

      const tokens = response?.usageMetadata?.totalTokenCount || 0;
      return { text, citations, tokens };
    }
  },

  openai: {
    endpoint: () => searchEndpoint("openai"),
    buildBody: (query, model) => {
      const body = {
        model,
        messages: [{ role: "user", content: query }]
      };
      // Non-search-preview models need explicit web_search tool
      if (!/search/i.test(model)) {
        body.tools = [{ type: "web_search" }];
      }
      return body;
    },
    buildHeaders: (token) => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    }),
    extractAnswer: (data) => {
      const msg = data?.choices?.[0]?.message || {};
      const text = msg.content || "";
      const annotations = Array.isArray(msg.annotations) ? msg.annotations : [];
      const fromAnn = annotations
        .map((a) => a?.url_citation)
        .filter(Boolean)
        .map((u) => ({ url: u.url, title: u.title || "" }));
      const fromTop = Array.isArray(data?.citations)
        ? data.citations.map(normalizeCitation).filter(Boolean)
        : [];
      const citations = fromAnn.length ? fromAnn : fromTop;
      const tokens = data?.usage?.total_tokens || 0;
      return { text, citations, tokens };
    }
  },

  xai: {
    endpoint: () => searchEndpoint("xai"),
    buildBody: (query, model) => ({
      model,
      input: [{ role: "user", content: query }],
      tools: [{ type: "web_search" }]
    }),
    buildHeaders: (token) => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    }),
    extractAnswer: (data) => {
      // /v1/responses returns output[] array of message/tool blocks
      const output = Array.isArray(data?.output) ? data.output : [];
      let text = "";
      const citations = [];
      for (const item of output) {
        const parts = Array.isArray(item?.content) ? item.content : [];
        for (const p of parts) {
          if (typeof p?.text === "string") text += p.text;
          const anns = Array.isArray(p?.annotations) ? p.annotations : [];
          for (const a of anns) {
            const c = normalizeCitation(a?.url ? a : a?.url_citation);
            if (c) citations.push(c);
          }
        }
      }
      // Fallback: top-level citations array (some response variants)
      if (!citations.length && Array.isArray(data?.citations)) {
        for (const c of data.citations) {
          const n = normalizeCitation(c);
          if (n) citations.push(n);
        }
      }
      const tokens = data?.usage?.total_tokens || 0;
      return { text, citations, tokens };
    }
  },

  kimi: {
    endpoint: () => searchEndpoint("kimi"),
    buildBody: (query, model) => ({
      model,
      messages: [{ role: "user", content: query }],
      tools: [
        { type: "builtin_function", function: { name: "$web_search" } }
      ]
    }),
    buildHeaders: (token) => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    }),
    extractAnswer: (data) => {
      const msg = data?.choices?.[0]?.message || {};
      const text = msg.content || "";
      const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
      const citations = [];
      for (const call of calls) {
        const argStr = call?.function?.arguments;
        if (!argStr) continue;
        let parsed;
        try {
          parsed = typeof argStr === "string" ? JSON.parse(argStr) : argStr;
        } catch {
          continue;
        }
        const items =
          parsed?.search_results ||
          parsed?.results ||
          parsed?.references ||
          [];
        if (Array.isArray(items)) {
          for (const it of items) {
            const url = it?.url || it?.link;
            if (!url) continue;
            citations.push({
              url,
              title: it.title || "",
              snippet: it.snippet || it.summary || ""
            });
          }
        }
      }
      const tokens = data?.usage?.total_tokens || 0;
      return { text, citations, tokens };
    }
  },

  minimax: {
    endpoint: () => searchEndpoint("minimax"),
    buildBody: (query, model) => ({
      model,
      messages: [{ role: "user", content: query }],
      tools: [{ type: "web_search" }]
    }),
    buildHeaders: (token) => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    }),
    extractAnswer: (data) => {
      const msg = data?.choices?.[0]?.message || {};
      const text = msg.content || "";
      const citations = [];
      const direct = Array.isArray(data?.web_search_results)
        ? data.web_search_results
        : [];
      for (const it of direct) {
        const url = it?.url || it?.link;
        if (url) {
          citations.push({
            url,
            title: it.title || "",
            snippet: it.snippet || it.summary || ""
          });
        }
      }
      if (!citations.length) {
        const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
        for (const call of calls) {
          const argStr = call?.function?.arguments;
          if (!argStr) continue;
          let parsed;
          try {
            parsed = typeof argStr === "string" ? JSON.parse(argStr) : argStr;
          } catch {
            continue;
          }
          const items = parsed?.results || parsed?.search_results || [];
          if (Array.isArray(items)) {
            for (const it of items) {
              const url = it?.url || it?.link;
              if (!url) continue;
              citations.push({
                url,
                title: it.title || "",
                snippet: it.snippet || ""
              });
            }
          }
        }
      }
      const tokens = data?.usage?.total_tokens || 0;
      return { text, citations, tokens };
    }
  },

  perplexity: {
    endpoint: () => searchEndpoint("perplexity"),
    buildBody: (query, model) => ({
      model,
      messages: [{ role: "user", content: query }]
    }),
    buildHeaders: (token) => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    }),
    extractAnswer: (data) => {
      const msg = data?.choices?.[0]?.message || {};
      const text = msg.content || "";
      const raw = data?.citations || [];
      const citations = Array.isArray(raw)
        ? raw.map(normalizeCitation).filter(Boolean)
        : [];
      const tokens = data?.usage?.total_tokens || 0;
      return { text, citations, tokens };
    }
  },

  "perplexity-agent": {
    endpoint: () => searchEndpoint("perplexity-agent"),
    buildBody: (query, model) => ({
      model,
      input: query,
      tools: [{ type: "web_search" }]
    }),
    buildHeaders: (token) => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    }),
    extractAnswer: (data) => {
      const output = Array.isArray(data?.output) ? data.output : [];
      let text = "";
      const citations = [];
      for (const item of output) {
        const parts = Array.isArray(item?.content) ? item.content : [];
        for (const p of parts) {
          if (typeof p?.text === "string") text += p.text;
          const anns = Array.isArray(p?.annotations) ? p.annotations : [];
          for (const a of anns) {
            const c = normalizeCitation(a?.url ? a : a?.url_citation);
            if (c) citations.push(c);
          }
        }
        const results = Array.isArray(item?.results) ? item.results : [];
        for (const r of results) {
          const url = r?.url || r?.link;
          if (!url) continue;
          citations.push({
            url,
            title: r?.title || "",
            snippet: r?.snippet || ""
          });
        }
      }
      if (!citations.length && Array.isArray(data?.citations)) {
        for (const c of data.citations) {
          const n = normalizeCitation(c);
          if (n) citations.push(n);
        }
      }
      const tokens = data?.usage?.total_tokens || 0;
      return { text, citations, tokens };
    }
  }
};

/**
 * Execute a chat-search request against the chosen provider.
 * @param {object} params
 * @param {string} params.provider
 * @param {string} params.query
 * @param {number} [params.maxResults]
 * @param {string} [params.model]
 * @param {{apiKey?:string, accessToken?:string}} params.credentials
 * @param {{info?:Function, warn?:Function, error?:Function}} [params.log]
 * @returns {Promise<{success:boolean, status?:number, error?:string, data?:object}>}
 */
export async function handleChatSearch({
  provider,
  query,
  maxResults,
  model,
  credentials,
  log
}) {
  const startTime = Date.now();
  const cfg = CHAT_SEARCH_CONFIG[provider];

  if (!cfg) {
    return {
      success: false,
      status: 400,
      error: `Unsupported chat-search provider: ${provider}`
    };
  }

  if (!query || typeof query !== "string") {
    return { success: false, status: 400, error: "Missing query" };
  }

  const token = credentials?.apiKey || credentials?.accessToken;
  if (!token) {
    return {
      success: false,
      status: 401,
      error: "Missing credentials (apiKey or accessToken)"
    };
  }

  const limit =
    Number.isFinite(maxResults) && maxResults > 0
      ? Math.floor(maxResults)
      : DEFAULT_MAX_RESULTS;
  const useModel = model || searchModel(provider);
  const url = cfg.endpoint(useModel);
  const body = cfg.buildBody(query, useModel, credentials);
  const headers = cfg.buildHeaders(token);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let upstreamStart = Date.now();
  let resp;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timer);
    if (err?.name === "AbortError") {
      log?.warn?.(`[chatSearch] timeout provider=${provider}`);
      return { success: false, status: 504, error: "Upstream timeout" };
    }
    log?.error?.(`[chatSearch] network error provider=${provider}: ${err?.message}`);
    return {
      success: false,
      status: 502,
      error: `Network error: ${err?.message || "unknown"}`
    };
  }
  clearTimeout(timer);
  const upstreamLatency = Date.now() - upstreamStart;

  let data;
  try {
    data = await resp.json();
  } catch {
    return {
      success: false,
      status: 502,
      error: `Invalid upstream response (status ${resp.status})`
    };
  }

  // TEMP DEBUG: log request/response for antigravity search failures
  if (provider === "antigravity" && !resp.ok) {
    console.log(`[SEARCH_DEBUG] url=${url} status=${resp.status}`);
    console.log(`[SEARCH_DEBUG] sent_body=${JSON.stringify(body).slice(0, 500)}`);
    console.log(`[SEARCH_DEBUG] response=${JSON.stringify(data).slice(0, 500)}`);
  }

  // Auto-fallback: if model capacity exhausted (503), retry with gemini-2.5-flash
  if (!resp.ok && resp.status === 503 && provider === "antigravity" && body?.model && body.model !== "gemini-2.5-flash") {
    console.log(`[SEARCH_FALLBACK] ${body.model} returned 503, falling back to gemini-2.5-flash`);
    const fallbackBody = { ...body, model: "gemini-2.5-flash" };
    const fallbackResp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(fallbackBody),
      signal: AbortSignal.timeout(60000),
    });
    let fallbackData;
    try { fallbackData = await fallbackResp.json(); } catch { fallbackData = null; }
    if (fallbackResp.ok && fallbackData) {
      data = fallbackData;
      resp = fallbackResp;
      // Update body.model so the response reflects the fallback model
      body.model = "gemini-2.5-flash";
    }
    // If fallback also fails, fall through to original error handling
  }

  if (!resp.ok) {
    const errMsg =
      data?.error?.message ||
      data?.error ||
      data?.message ||
      `Upstream HTTP ${resp.status}`;
    log?.warn?.(`[chatSearch] upstream error provider=${provider} status=${resp.status}`);
    return {
      success: false,
      status: resp.status,
      error: typeof errMsg === "string" ? errMsg : JSON.stringify(errMsg)
    };
  }

  const { text, citations, tokens } = cfg.extractAnswer(data);
  const retrievedAt = new Date().toISOString();
  const limited = (citations || []).slice(0, limit);
  const results = limited.map((c, i) => toResult(c, i, provider, retrievedAt));

  return {
    success: true,
    status: 200,
    data: {
      provider,
      query,
      results,
      answer: { source: provider, text: text || "", model: useModel },
      usage: { queries_used: 1, search_cost_usd: 0, llm_tokens: tokens || 0 },
      metrics: {
        response_time_ms: Date.now() - startTime,
        upstream_latency_ms: upstreamLatency,
        total_results_available: null
      },
      errors: []
    }
  };
}

export { CHAT_SEARCH_CONFIG };
