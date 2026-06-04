import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";

const PPLX_SSE_ENDPOINT = PROVIDERS["perplexity-web"].baseUrl;
const PPLX_API_VERSION = "2.18";
const PPLX_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const MODEL_MAP = {
  "pplx-auto": ["concise", "pplx_pro"],
  "pplx-sonar": ["copilot", "experimental"],
  "pplx-gpt": ["copilot", "gpt54"],
  "pplx-gemini": ["copilot", "gemini31pro_high"],
  "pplx-sonnet": ["copilot", "claude46sonnet"],
  "pplx-opus": ["copilot", "claude46opus"],
  "pplx-nemotron": ["copilot", "nv_nemotron_3_super"],
};

const THINKING_MAP = {
  "pplx-gpt": "gpt54_thinking",
  "pplx-sonnet": "claude46sonnetthinking",
  "pplx-opus": "claude46opusthinking",
};

const CITATION_RE = /\[\d+\]/g;
const GROK_TAG_RE = /<grok:[^>]*>.*?<\/grok:[^>]*>/gs;
const GROK_SELF_RE = /<grok:[^>]*\/>/g;
const XML_DECL_RE = /<[?]xml[^?]*[?]>/g;
const RESPONSE_TAG_RE = /<\/?response\b[^>]*>/gi;
const MULTI_SPACE = / {2,}/g;
const MULTI_NL = /\n{3,}/g;

const SESSION_MAX_AGE_MS = 3600_000;
const SESSION_MAX_ENTRIES = 200;

const sessionCache = new Map();

// FNV-1a hash for session key lookup
function sessionKey(history) {
  const parts = history.map((h) => `${h.role}:${h.content}`).join("\n");
  let hash = 0x811c9dc5;
  for (let i = 0; i < parts.length; i++) {
    hash ^= parts.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function sessionLookup(history) {
  if (history.length === 0) return null;
  const key = sessionKey(history);
  const entry = sessionCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > SESSION_MAX_AGE_MS) {
    sessionCache.delete(key);
    return null;
  }
  return entry.backendUuid;
}

function sessionStore(history, currentMsg, responseText, backendUuid) {
  if (!backendUuid) return;
  const full = [...history, { role: "user", content: currentMsg }, { role: "assistant", content: responseText }];
  const key = sessionKey(full);
  sessionCache.set(key, { backendUuid, ts: Date.now() });
  if (sessionCache.size > SESSION_MAX_ENTRIES) {
    let oldestKey = null;
    let oldestTs = Infinity;
    for (const [k, v] of sessionCache) {
      if (v.ts < oldestTs) { oldestTs = v.ts; oldestKey = k; }
    }
    if (oldestKey) sessionCache.delete(oldestKey);
  }
}

function cleanResponse(text, strip = true) {
  let t = text;
  t = t.replace(XML_DECL_RE, "");
  t = t.replace(CITATION_RE, "");
  t = t.replace(GROK_TAG_RE, "");
  t = t.replace(GROK_SELF_RE, "");
  t = t.replace(RESPONSE_TAG_RE, "");
  if (strip) {
    t = t.replace(MULTI_SPACE, " ");
    t = t.replace(MULTI_NL, "\n\n");
    t = t.trim();
  }
  return t;
}

async function* readPplxSseEvents(body, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines = [];

  function flush() {
    if (dataLines.length === 0) return null;
    const payload = dataLines.join("\n");
    dataLines = [];
    const trimmed = payload.trim();
    if (!trimmed || trimmed === "[DONE]") return "done";
    try { return JSON.parse(trimmed); } catch { return null; }
  }

  try {
    while (true) {
      if (signal?.aborted) return;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const idx = buffer.indexOf("\n");
        if (idx < 0) break;
        const rawLine = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
        if (line === "") {
          const parsed = flush();
          if (parsed === "done") return;
          if (parsed) yield parsed;
          continue;
        }
        if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
        if (line === "event: end_of_stream") return;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim().startsWith("data:")) dataLines.push(buffer.trim().slice(5).trimStart());
    const tail = flush();
    if (tail && tail !== "done") yield tail;
  } finally {
    reader.releaseLock();
  }
}

function parseOpenAIMessages(messages) {
  let systemMsg = "";
  const history = [];
  for (const msg of messages) {
    let role = String(msg.role || "user");
    if (role === "developer") role = "system";
    let content = "";
    if (typeof msg.content === "string") content = msg.content;
    else if (Array.isArray(msg.content)) {
      content = msg.content.filter((c) => c.type === "text").map((c) => String(c.text || "")).join(" ");
    }
    if (!content.trim()) continue;
    if (role === "system") systemMsg += content + "\n";
    else if (role === "user" || role === "assistant") history.push({ role, content });
  }
  let currentMsg = "";
  if (history.length > 0 && history[history.length - 1].role === "user") {
    currentMsg = history.pop().content;
  }
  return { systemMsg, history, currentMsg };
}

function buildPplxRequestBody(query, mode, modelPref, followUpUuid) {
  const tz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";
  return {
    query_str: query,
    params: {
      query_str: query,
      search_focus: "internet",
      mode,
      model_preference: modelPref,
      sources: ["web"],
      attachments: [],
      frontend_uuid: crypto.randomUUID(),
      frontend_context_uuid: crypto.randomUUID(),
      version: PPLX_API_VERSION,
      language: "en-US",
      timezone: tz,
      search_recency_filter: null,
      is_incognito: true,
      use_schematized_api: true,
      last_backend_uuid: followUpUuid,
    },
  };
}

function formatToolsHint(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return "";
  const lines = tools.map((t) => {
    const fn = t?.function || t || {};
    const name = fn.name || "unnamed";
    const desc = (fn.description || "").split("\n")[0].slice(0, 200);
    return `- ${name}: ${desc}`;
  });
  return `Available tools (reference only, cannot invoke):\n${lines.join("\n")}`;
}

function buildQuery(parsed, followUpUuid, tools) {
  if (followUpUuid) return parsed.currentMsg;
  const obj = {};
  const instr = [];
  if (parsed.systemMsg.trim()) instr.push(parsed.systemMsg.trim());
  const toolsHint = formatToolsHint(tools);
  if (toolsHint) instr.push(toolsHint);
  instr.push("You have built-in web search. Answer questions directly using search results.");
  obj.instructions = instr;
  if (parsed.history.length > 0) obj.history = parsed.history;
  if (parsed.currentMsg) obj.query = parsed.currentMsg;
  else if (parsed.history.length === 0) obj.query = "";
  const json = JSON.stringify(obj);
  return json.length > 96000 ? json.slice(-96000) : json;
}

async function* extractContent(eventStream, signal) {
  let fullAnswer = "";
  let backendUuid = null;
  let seenLen = 0;
  const seenThinking = new Set();

  for await (const event of readPplxSseEvents(eventStream, signal)) {
    if (event.error_code || event.error_message) {
      yield { error: event.error_message || `Perplexity error: ${event.error_code}`, done: true };
      return;
    }
    if (event.backend_uuid) backendUuid = event.backend_uuid;

    const blocks = event.blocks ?? [];
    for (const block of blocks) {
      const usage = block.intended_usage ?? "";

      if (usage === "pro_search_steps" && block.plan_block?.steps) {
        for (const step of block.plan_block.steps) {
          if (step.step_type === "SEARCH_WEB") {
            for (const q of step.search_web_content?.queries ?? []) {
              const qr = q.query ?? "";
              if (qr && !seenThinking.has(qr)) {
                seenThinking.add(qr);
                yield { thinking: `Searching: ${qr}`, backendUuid: backendUuid ?? undefined };
              }
            }
          } else if (step.step_type === "READ_RESULTS") {
            for (const u of (step.read_results_content?.urls ?? []).slice(0, 3)) {
              if (u && !seenThinking.has(u)) {
                seenThinking.add(u);
                yield { thinking: `Reading: ${u}`, backendUuid: backendUuid ?? undefined };
              }
            }
          }
        }
      }

      if (usage === "plan" && block.plan_block?.goals) {
        for (const goal of block.plan_block.goals) {
          const desc = goal.description ?? "";
          if (desc && !seenThinking.has(desc)) {
            seenThinking.add(desc);
            yield { thinking: desc, backendUuid: backendUuid ?? undefined };
          }
        }
      }

      if (!usage.includes("markdown")) continue;
      const mb = block.markdown_block;
      if (!mb) continue;
      const chunks = mb.chunks ?? [];
      if (chunks.length === 0) continue;

      if (mb.progress === "DONE") {
        fullAnswer = chunks.join("");
      } else {
        const chunkText = chunks.join("");
        const cumulative = fullAnswer + chunkText;
        if (cumulative.length > seenLen) {
          const delta = cumulative.slice(seenLen);
          fullAnswer = cumulative;
          seenLen = cumulative.length;
          yield { delta, answer: fullAnswer, backendUuid: backendUuid ?? undefined };
        }
      }
    }

    if (blocks.length === 0 && event.text) {
      const t = event.text.trim();
      if (t.length > seenLen) {
        const delta = t.slice(seenLen);
        fullAnswer = t;
        seenLen = t.length;
        yield { delta, answer: fullAnswer, backendUuid: backendUuid ?? undefined };
      }
    }

    if (event.final || event.status === "COMPLETED") break;
  }
  yield { delta: "", answer: fullAnswer, backendUuid: backendUuid ?? undefined, done: true };
}

function sseChunk(data) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function buildStreamingResponse(eventStream, model, cid, created, history, currentMsg, signal) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null, logprobs: null }],
        })));

        let fullAnswer = "";
        let respBackendUuid = null;

        for await (const chunk of extractContent(eventStream, signal)) {
          if (chunk.backendUuid) respBackendUuid = chunk.backendUuid;
          if (chunk.error) {
            controller.enqueue(encoder.encode(sseChunk({
              id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
              choices: [{ index: 0, delta: { content: `[Error: ${chunk.error}]` }, finish_reason: null, logprobs: null }],
            })));
            break;
          }
          if (chunk.thinking) {
            controller.enqueue(encoder.encode(sseChunk({
              id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
              choices: [{ index: 0, delta: { reasoning_content: chunk.thinking + "\n" }, finish_reason: null, logprobs: null }],
            })));
            continue;
          }
          if (chunk.done) { fullAnswer = chunk.answer || fullAnswer; break; }
          let dt = chunk.delta || "";
          if (dt) {
            dt = cleanResponse(dt, false);
            if (dt) {
              controller.enqueue(encoder.encode(sseChunk({
                id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
                choices: [{ index: 0, delta: { content: dt }, finish_reason: null, logprobs: null }],
              })));
            }
          }
          if (chunk.answer) fullAnswer = chunk.answer;
        }

        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
          choices: [{ index: 0, delta: {}, finish_reason: "stop", logprobs: null }],
        })));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));

        sessionStore(history, currentMsg, cleanResponse(fullAnswer), respBackendUuid);
      } catch (err) {
        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
          choices: [{ index: 0, delta: { content: `[Stream error: ${err.message || String(err)}]` }, finish_reason: "stop", logprobs: null }],
        })));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } finally {
        controller.close();
      }
    },
  });
}

async function buildNonStreamingResponse(eventStream, model, cid, created, history, currentMsg, signal) {
  let fullAnswer = "";
  let respBackendUuid = null;
  const thinkingParts = [];

  for await (const chunk of extractContent(eventStream, signal)) {
    if (chunk.backendUuid) respBackendUuid = chunk.backendUuid;
    if (chunk.error) {
      return new Response(JSON.stringify({
        error: { message: chunk.error, type: "upstream_error", code: "PPLX_ERROR" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
    }
    if (chunk.thinking) { thinkingParts.push(chunk.thinking); continue; }
    if (chunk.done) { fullAnswer = chunk.answer || fullAnswer; break; }
    if (chunk.answer) fullAnswer = chunk.answer;
  }

  fullAnswer = cleanResponse(fullAnswer);
  sessionStore(history, currentMsg, fullAnswer, respBackendUuid);

  const reasoningContent = thinkingParts.length > 0 ? thinkingParts.join("\n") : undefined;
  const msg = { role: "assistant", content: fullAnswer };
  if (reasoningContent) msg.reasoning_content = reasoningContent;

  const promptTokens = Math.ceil(currentMsg.length / 4);
  const completionTokens = Math.ceil(fullAnswer.length / 4);

  return new Response(JSON.stringify({
    id: cid, object: "chat.completion", created, model, system_fingerprint: null,
    choices: [{ index: 0, message: msg, finish_reason: "stop", logprobs: null }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

export class PerplexityWebExecutor extends BaseExecutor {
  constructor() {
    super("perplexity-web", PROVIDERS["perplexity-web"]);
  }

  async execute({ model, body, stream, credentials, signal, log }) {
    const messages = body?.messages;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Missing or empty messages array", type: "invalid_request" },
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: PPLX_SSE_ENDPOINT, headers: {}, transformedBody: body };
    }

    const thinking = body?.thinking === true || (body?.reasoning_effort != null && body.reasoning_effort !== "none");

    let pplxMode;
    let modelPref;
    if (thinking && THINKING_MAP[model]) {
      pplxMode = "copilot";
      modelPref = THINKING_MAP[model];
      log?.info?.("PPLX-WEB", `Thinking mode → ${model} using ${modelPref}`);
    } else if (MODEL_MAP[model]) {
      [pplxMode, modelPref] = MODEL_MAP[model];
    } else {
      pplxMode = "copilot";
      modelPref = model;
      log?.info?.("PPLX-WEB", `Unmapped model ${model}, using as raw preference`);
    }

    const parsed = parseOpenAIMessages(messages);
    const followUpUuid = sessionLookup(parsed.history);
    if (followUpUuid) log?.info?.("PPLX-WEB", `Session continue: ${followUpUuid.slice(0, 12)}...`);

    const query = buildQuery(parsed, followUpUuid, body?.tools);
    if (!query.trim()) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Empty query after processing", type: "invalid_request" },
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: PPLX_SSE_ENDPOINT, headers: {}, transformedBody: body };
    }

    const pplxBody = buildPplxRequestBody(query, pplxMode, modelPref, followUpUuid);

    const headers = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Origin: "https://www.perplexity.ai",
      Referer: "https://www.perplexity.ai/",
      "User-Agent": PPLX_USER_AGENT,
      "X-App-ApiClient": "default",
      "X-App-ApiVersion": PPLX_API_VERSION,
    };

    if (credentials.accessToken) {
      headers["Authorization"] = `Bearer ${credentials.accessToken}`;
    } else if (credentials.apiKey) {
      headers["Cookie"] = `__Secure-next-auth.session-token=${credentials.apiKey}`;
    }

    log?.info?.("PPLX-WEB", `Query to ${model} (pref=${modelPref}, mode=${pplxMode}), len=${query.length}`);

    const fetchOptions = { method: "POST", headers, body: JSON.stringify(pplxBody) };
    if (signal) fetchOptions.signal = signal;

    let response;
    try {
      response = await fetch(PPLX_SSE_ENDPOINT, fetchOptions);
    } catch (err) {
      log?.error?.("PPLX-WEB", `Fetch failed: ${err.message || String(err)}`);
      const errResp = new Response(JSON.stringify({
        error: { message: `Perplexity connection failed: ${err.message || String(err)}`, type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: PPLX_SSE_ENDPOINT, headers, transformedBody: pplxBody };
    }

    if (!response.ok) {
      const status = response.status;
      let errMsg = `Perplexity returned HTTP ${status}`;
      if (status === 401 || status === 403) errMsg = "Perplexity auth failed — session cookie may be expired. Re-paste your __Secure-next-auth.session-token.";
      else if (status === 429) errMsg = "Perplexity rate limited. Wait a moment and retry.";
      log?.warn?.("PPLX-WEB", errMsg);
      const errResp = new Response(JSON.stringify({
        error: { message: errMsg, type: "upstream_error", code: `HTTP_${status}` },
      }), { status, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: PPLX_SSE_ENDPOINT, headers, transformedBody: pplxBody };
    }

    if (!response.body) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Perplexity returned empty response body", type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: PPLX_SSE_ENDPOINT, headers, transformedBody: pplxBody };
    }

    const cid = `chatcmpl-pplx-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    let finalResponse;
    if (stream) {
      const sseStream = buildStreamingResponse(response.body, model, cid, created, parsed.history, parsed.currentMsg, signal);
      finalResponse = new Response(sseStream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" },
      });
    } else {
      finalResponse = await buildNonStreamingResponse(response.body, model, cid, created, parsed.history, parsed.currentMsg, signal);
    }
    return { response: finalResponse, url: PPLX_SSE_ENDPOINT, headers, transformedBody: pplxBody };
  }
}

export { parseOpenAIMessages, buildQuery, buildPplxRequestBody, formatToolsHint, sessionKey };

export default PerplexityWebExecutor;
