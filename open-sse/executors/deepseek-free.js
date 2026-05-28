'use strict';

import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { solvePow, buildPowHeader } from "../utils/deepseekPow.js";
import sieveModule from "../utils/stream-tool-sieve/index.js";
const {
  createToolSieveState,
  processToolSieveChunk,
  flushToolSieve,
  formatOpenAIStreamToolCalls,
} = sieveModule;

// Formatting helper functions
function formatToolCallsForPrompt(toolCalls) {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return "";
  const blocks = [];
  for (const tc of toolCalls) {
    const name = tc.name || tc.function?.name;
    if (!name) continue;
    let args = tc.arguments || tc.input;
    if (typeof args === 'string') {
      try { args = JSON.parse(args); } catch { }
    }
    const params = [];
    if (args && typeof args === 'object') {
      for (const [k, v] of Object.entries(args)) {
        const valStr = typeof v === 'object' ? JSON.stringify(v) : String(v);
        params.push(`    <|DSML|parameter name="${k}"><![CDATA[${valStr}]]></|DSML|parameter>`);
      }
    }
    blocks.push(`  <|DSML|invoke name="${name}">\n${params.join('\n')}\n  </|DSML|invoke>`);
  }
  if (blocks.length === 0) return "";
  return `<|DSML|tool_calls>\n${blocks.join('\n')}\n</|DSML|tool_calls>`;
}

function formatToolSchemas(tools) {
  const schemas = [];
  for (const t of tools) {
    if (!t || typeof t !== 'object') continue;
    const name = t.name || t.function?.name || "";
    const desc = t.description || t.function?.description || "No description available";
    const params = t.parameters || t.function?.parameters || {};
    schemas.push(`Tool: ${name}\nDescription: ${desc}\nParameters: ${JSON.stringify(params)}`);
  }
  return "You have access to these tools:\n\n" + schemas.join("\n\n");
}

function buildToolCallInstructions(toolNames) {
  return `TOOL CALL FORMAT — FOLLOW EXACTLY:

<|DSML|tool_calls>
  <|DSML|invoke name="TOOL_NAME_HERE">
    <|DSML|parameter name="PARAMETER_NAME"><![CDATA[PARAMETER_VALUE]]></|DSML|parameter>
  </|DSML|invoke>
</|DSML|tool_calls>

RULES:
1) Use the <|DSML|tool_calls> wrapper format.
2) Put one or more <|DSML|invoke> entries under a single <|DSML|tool_calls> root.
3) Put the tool name in the invoke name attribute: <|DSML|invoke name="TOOL_NAME">.
3a) Tag punctuation alphabet: ASCII < > / = " plus the halfwidth pipe |.
4) All string values must use <![CDATA[...]]>, even short ones. This includes code, scripts, file contents, prompts, paths, names, and queries.
5) Every top-level argument must be a <|DSML|parameter name="ARG_NAME">...</|DSML|parameter> node.
6) Objects use nested XML elements inside the parameter body. Arrays may repeat <item> children.
7) Numbers, booleans, and null stay plain text.
8) Use only the parameter names in the tool schema. Do not invent fields.
9) Fill parameters with the actual values required for this call. Do not emit placeholder, blank, or whitespace-only parameters.
10) If a required parameter value is unknown, ask the user or answer normally instead of outputting an empty tool call.
11) Do NOT wrap XML in markdown fences. Do NOT output explanations, role markers, or internal monologue.
12) If you call a tool, the first non-whitespace characters of that tool block must be exactly <|DSML|tool_calls>.
13) Never omit the opening <|DSML|tool_calls> tag, even if you already plan to close with </|DSML|tool_calls>.

【CORRECT EXAMPLE】:
<|DSML|tool_calls>
  <|DSML|invoke name="${toolNames[0] || 'example_tool'}">
    <|DSML|parameter name="param1"><![CDATA[value1]]></|DSML|parameter>
  </|DSML|invoke>
</|DSML|tool_calls>

Remember: The ONLY valid way to use tools is the <|DSML|tool_calls>...</|DSML|tool_calls> block at the end of your response.`;
}

const DEEPSEEK_LOGIN_URL = "https://chat.deepseek.com/api/v0/users/login";
const DEEPSEEK_CREATE_SESSION_URL = "https://chat.deepseek.com/api/v0/chat_session/create";
const DEEPSEEK_CREATE_POW_URL = "https://chat.deepseek.com/api/v0/chat/create_pow_challenge";
const DEEPSEEK_COMPLETION_URL = "https://chat.deepseek.com/api/v0/chat/completion";

const DEEPSEEK_BASE_HEADERS = {
  "Host": "chat.deepseek.com",
  "Accept": "application/json",
  "Content-Type": "application/json",
  "accept-charset": "UTF-8",
  "User-Agent": "DeepSeek/2.0.4 Android/35",
  "x-client-platform": "android",
  "x-client-version": "2.0.4",
  "x-client-locale": "zh_CN"
};

// Global in-memory token cache to avoid logging in on every request
const TOKEN_CACHE = new Map(); // username -> token

// Helper to normalize username (email or mobile with area code)
function normalizeUsername(raw) {
  const s = (raw || "").trim();
  if (!s) return { email: "", mobile: "", areaCode: "" };

  if (s.includes("@")) {
    return { email: s, mobile: "", areaCode: "" };
  }

  // Mobile format: e.g. "+8613800000000" or "8613800000000" or just digits
  const hasPlus = s.startsWith("+");
  const digits = s.replace(/\D/g, "");

  if ((hasPlus || digits.startsWith("86")) && digits.startsWith("86") && digits.length === 13) {
    return { email: "", mobile: digits.slice(2), areaCode: "86" };
  }

  return { email: "", mobile: digits, areaCode: "" };
}

function parseOpenAIMessages(messages) {
  let prompt = "";
  for (const msg of messages) {
    let role = msg.role || "user";
    if (role === "developer") role = "system";
    let content = "";
    if (typeof msg.content === "string") {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      content = msg.content
        .filter(c => c.type === "text")
        .map(c => String(c.text || ""))
        .join(" ");
    }
    
    // Format assistant tool_calls in history
    if (role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
      const toolHistory = formatToolCallsForPrompt(msg.tool_calls);
      if (toolHistory) {
        content = (content ? content + "\n\n" : "") + toolHistory;
      }
    }
    
    if (role === "tool" || role === "function") {
      role = "tool";
      if (!content.trim()) content = "null";
    }

    if (!content.trim() && role !== "tool") continue;
    prompt += `${role.toUpperCase()}: ${content}\n\n`;
  }
  return prompt.trim();
}

async function* readDeepseekNdjsonEvents(body, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) return;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const idx = buffer.indexOf("\n");
        if (idx < 0) break;
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        if (line.startsWith("data:")) {
          const dataStr = line.slice(5).trim();
          if (!dataStr) continue;
          if (dataStr === "[DONE]") {
            yield { done: true };
            return;
          }
          try {
            yield JSON.parse(dataStr);
          } catch {
            // ignore malformed JSON
          }
        }
      }
    }
    buffer += decoder.decode();
    const remaining = buffer.trim();
    if (remaining && remaining.startsWith("data:")) {
      const dataStr = remaining.slice(5).trim();
      if (dataStr && dataStr !== "[DONE]") {
        try {
          yield JSON.parse(dataStr);
        } catch {
          // ignore
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseChunkForContent(chunk, thinkingEnabled) {
  if (!chunk || typeof chunk !== 'object') {
    return null;
  }

  if (chunk.error) {
    return { error: typeof chunk.error === 'string' ? chunk.error : JSON.stringify(chunk.error) };
  }

  // Handle content filter
  if (chunk.code && chunk.code.toLowerCase() === 'content_filter') {
    return { finished: true, finishReason: 'content_filter' };
  }

  const pathValue = chunk.p || '';
  const val = chunk.v;

  // Handle status / finished
  if (pathValue === 'response/status' || pathValue === 'status') {
    if (String(val).toUpperCase() === 'FINISHED') {
      return { finished: true, finishReason: 'stop' };
    }
  }

  // Handle text deltas
  if (pathValue === 'response/content' && typeof val === 'string') {
    return { text: val };
  }

  // Handle reasoning / thinking deltas
  if (pathValue === 'response/thinking_content' && typeof val === 'string') {
    return thinkingEnabled ? { thinking: val } : null;
  }

  // Handle fragments append format
  if (pathValue === 'response/fragments' && chunk.o === 'APPEND' && Array.isArray(val)) {
    let text = '';
    let thinking = '';
    for (const frag of val) {
      if (!frag || typeof frag !== 'object') continue;
      const fragType = String(frag.type || '').toUpperCase();
      const content = frag.content || '';
      if (!content) continue;

      if (fragType === 'THINK' || fragType === 'THINKING') {
        if (thinkingEnabled) thinking += content;
      } else {
        text += content;
      }
    }
    if (text || thinking) {
      const res = {};
      if (text) res.text = text;
      if (thinking) res.thinking = thinking;
      return res;
    }
  }

  // If no path but direct string value (some backend variations)
  if (!pathValue && typeof val === 'string') {
    if (val === 'FINISHED') {
      return { finished: true, finishReason: 'stop' };
    }
    return { text: val };
  }

  return null;
}

function sseChunk(data) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function buildStreamingResponse(eventStream, model, cid, created, thinkingEnabled, tools, signal) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null, logprobs: null }],
        })));

        const idStore = new Map();
        const toolNames = Array.isArray(tools) ? tools.map(t => t.name || t.function?.name).filter(Boolean) : [];
        const useSieve = toolNames.length > 0;
        const sieveState = useSieve ? createToolSieveState() : null;
        let toolCallsEmitted = false;

        for await (const chunk of readDeepseekNdjsonEvents(eventStream, signal)) {
          if (chunk.done) break;

          const parsed = parseChunkForContent(chunk, thinkingEnabled);
          if (!parsed) continue;

          if (parsed.error) {
            controller.enqueue(encoder.encode(sseChunk({
              id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
              choices: [{ index: 0, delta: { content: `[Error: ${parsed.error}]` }, finish_reason: null, logprobs: null }],
            })));
            break;
          }

          if (parsed.thinking) {
            controller.enqueue(encoder.encode(sseChunk({
              id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
              choices: [{ index: 0, delta: { reasoning_content: parsed.thinking }, finish_reason: null, logprobs: null }],
            })));
          }

          if (parsed.text) {
            if (useSieve) {
              const events = processToolSieveChunk(sieveState, parsed.text, toolNames);
              for (const ev of events) {
                if (ev.type === 'text' && ev.text) {
                  controller.enqueue(encoder.encode(sseChunk({
                    id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
                    choices: [{ index: 0, delta: { content: ev.text }, finish_reason: null, logprobs: null }],
                  })));
                } else if (ev.type === 'tool_calls' && Array.isArray(ev.calls) && ev.calls.length > 0) {
                  toolCallsEmitted = true;
                  const formattedCalls = formatOpenAIStreamToolCalls(ev.calls, idStore, tools);
                  controller.enqueue(encoder.encode(sseChunk({
                    id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
                    choices: [{ index: 0, delta: { tool_calls: formattedCalls }, finish_reason: null, logprobs: null }],
                  })));
                }
              }
            } else {
              controller.enqueue(encoder.encode(sseChunk({
                id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
                choices: [{ index: 0, delta: { content: parsed.text }, finish_reason: null, logprobs: null }],
              })));
            }
          }

          if (parsed.finished) {
            if (useSieve) {
              const events = flushToolSieve(sieveState, toolNames);
              for (const ev of events) {
                if (ev.type === 'text' && ev.text) {
                  controller.enqueue(encoder.encode(sseChunk({
                    id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
                    choices: [{ index: 0, delta: { content: ev.text }, finish_reason: null, logprobs: null }],
                  })));
                } else if (ev.type === 'tool_calls' && Array.isArray(ev.calls) && ev.calls.length > 0) {
                  toolCallsEmitted = true;
                  const formattedCalls = formatOpenAIStreamToolCalls(ev.calls, idStore, tools);
                  controller.enqueue(encoder.encode(sseChunk({
                    id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
                    choices: [{ index: 0, delta: { tool_calls: formattedCalls }, finish_reason: null, logprobs: null }],
                  })));
                }
              }
            }
            const finalFinishReason = toolCallsEmitted ? "tool_calls" : (parsed.finishReason || "stop");
            controller.enqueue(encoder.encode(sseChunk({
              id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
              choices: [{ index: 0, delta: {}, finish_reason: finalFinishReason, logprobs: null }],
            })));
            break;
          }
        }

        if (useSieve && !toolCallsEmitted) {
          const events = flushToolSieve(sieveState, toolNames);
          for (const ev of events) {
            if (ev.type === 'text' && ev.text) {
              controller.enqueue(encoder.encode(sseChunk({
                id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
                choices: [{ index: 0, delta: { content: ev.text }, finish_reason: null, logprobs: null }],
              })));
            } else if (ev.type === 'tool_calls' && Array.isArray(ev.calls) && ev.calls.length > 0) {
              toolCallsEmitted = true;
              const formattedCalls = formatOpenAIStreamToolCalls(ev.calls, idStore, tools);
              controller.enqueue(encoder.encode(sseChunk({
                id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
                choices: [{ index: 0, delta: { tool_calls: formattedCalls }, finish_reason: null, logprobs: null }],
              })));
            }
          }
        }

        const finalFinishReason = toolCallsEmitted ? "tool_calls" : "stop";
        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
          choices: [{ index: 0, delta: {}, finish_reason: finalFinishReason, logprobs: null }],
        })));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
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

async function buildNonStreamingResponse(eventStream, model, cid, created, thinkingEnabled, tools, signal) {
  let fullContent = "";
  let reasoningContent = "";

  for await (const chunk of readDeepseekNdjsonEvents(eventStream, signal)) {
    if (chunk.done) break;

    const parsed = parseChunkForContent(chunk, thinkingEnabled);
    if (!parsed) continue;

    if (parsed.error) {
      return new Response(JSON.stringify({
        error: { message: parsed.error, type: "upstream_error", code: "DEEPSEEK_FREE_ERROR" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
    }

    if (parsed.thinking) {
      reasoningContent += parsed.thinking;
    }
    if (parsed.text) {
      fullContent += parsed.text;
    }
    if (parsed.finished) {
      break;
    }
  }

  const msg = { role: "assistant" };
  if (reasoningContent) msg.reasoning_content = reasoningContent;

  const toolNames = Array.isArray(tools) ? tools.map(t => t.name || t.function?.name).filter(Boolean) : [];
  if (toolNames.length > 0) {
    const sieveState = createToolSieveState();
    const events = processToolSieveChunk(sieveState, fullContent, toolNames);
    events.push(...flushToolSieve(sieveState, toolNames));

    let proseText = "";
    const toolCallsList = [];
    const idStore = new Map();

    for (const ev of events) {
      if (ev.type === 'text' && ev.text) {
        proseText += ev.text;
      } else if (ev.type === 'tool_calls' && Array.isArray(ev.calls) && ev.calls.length > 0) {
        const formattedCalls = formatOpenAIStreamToolCalls(ev.calls, idStore, tools);
        toolCallsList.push(...formattedCalls);
      }
    }

    if (toolCallsList.length > 0) {
      msg.content = proseText || null;
      msg.tool_calls = toolCallsList;
    } else {
      msg.content = fullContent;
    }
  } else {
    msg.content = fullContent;
  }

  const promptTokens = Math.ceil((msg.content || "").length / 4);
  const completionTokens = Math.ceil((msg.content || "").length / 4);

  return new Response(JSON.stringify({
    id: cid, object: "chat.completion", created, model, system_fingerprint: null,
    choices: [{ index: 0, message: msg, finish_reason: msg.tool_calls ? "tool_calls" : "stop", logprobs: null }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

export class DeepSeekFreeExecutor extends BaseExecutor {
  constructor() {
    super("deepseek-free", PROVIDERS["deepseek-free"]);
  }

  async login(username, password) {
    const { email, mobile, areaCode } = normalizeUsername(username);
    const payload = {
      password: String(password).trim(),
      device_id: "deepseek_to_api",
      os: "android",
    };
    if (email) {
      payload.email = email;
    } else if (mobile) {
      payload.mobile = mobile;
      payload.area_code = areaCode ? Number(areaCode) : 86;
    } else {
      throw new Error("Missing email or mobile number");
    }

    const response = await fetch(DEEPSEEK_LOGIN_URL, {
      method: "POST",
      headers: DEEPSEEK_BASE_HEADERS,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Login failed with HTTP ${response.status}`);
    }

    const data = await response.json();
    if (data.code !== 0) {
      throw new Error(data.msg || "Login failed");
    }

    const bizData = data.data?.biz_data;
    const token = bizData?.user?.token;
    if (!token) {
      throw new Error(bizData?.biz_msg || "Missing token in login response");
    }

    TOKEN_CACHE.set(username, token);
    return token;
  }

  async getOrRefreshToken(username, password, forceRefresh = false) {
    if (!forceRefresh && TOKEN_CACHE.has(username)) {
      return TOKEN_CACHE.get(username);
    }
    return await this.login(username, password);
  }

  async createSession(token) {
    const response = await fetch(DEEPSEEK_CREATE_SESSION_URL, {
      method: "POST",
      headers: {
        ...DEEPSEEK_BASE_HEADERS,
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ agent: "chat" }),
    });

    if (!response.ok) {
      throw new Error(`Session creation failed with HTTP ${response.status}`);
    }

    const data = await response.json();
    if (data.code !== 0) {
      throw new Error(data.msg || "Session creation failed");
    }

    const bizData = data.data?.biz_data;
    const sessionId = bizData?.id || bizData?.chat_session?.id;
    if (!sessionId) {
      throw new Error("Missing session ID in creation response");
    }

    return sessionId;
  }

  async getAndSolvePow(token, signal) {
    const response = await fetch(DEEPSEEK_CREATE_POW_URL, {
      method: "POST",
      headers: {
        ...DEEPSEEK_BASE_HEADERS,
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ target_path: "/api/v0/chat/completion" }),
    });

    if (!response.ok) {
      throw new Error(`Failed to create PoW challenge with HTTP ${response.status}`);
    }

    const data = await response.json();
    if (data.code !== 0) {
      throw new Error(data.msg || "PoW challenge failed");
    }

    const challenge = data.data?.biz_data?.challenge;
    if (!challenge) {
      throw new Error("Missing challenge object from DeepSeek PoW");
    }

    const answer = await solvePow(
      challenge.challenge,
      challenge.salt,
      challenge.expire_at,
      challenge.difficulty,
      signal
    );

    return buildPowHeader(challenge, answer);
  }

  async execute({ model, body, stream, credentials, signal, log }) {
    const username = credentials.providerSpecificData?.username;
    const password = credentials.apiKey || credentials.accessToken;

    if (!username || !password) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Username (email/mobile) and Password (API Key field) are required for deepseek-free", type: "invalid_request" },
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: DEEPSEEK_COMPLETION_URL, headers: {}, transformedBody: body };
    }

    const messages = body?.messages;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Missing or empty messages array", type: "invalid_request" },
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: DEEPSEEK_COMPLETION_URL, headers: {}, transformedBody: body };
    }

    let processedMessages = messages;
    if (Array.isArray(body.tools) && body.tools.length > 0) {
      const toolNames = body.tools.map(t => t.name || t.function?.name).filter(Boolean);
      const toolsPrompt = formatToolSchemas(body.tools) + "\n\n" + buildToolCallInstructions(toolNames);
      
      // Copy messages so we don't mutate input
      processedMessages = messages.map(m => ({ ...m }));
      
      let systemFound = false;
      for (let i = 0; i < processedMessages.length; i++) {
        if (processedMessages[i].role === "system" || processedMessages[i].role === "developer") {
          const oldContent = processedMessages[i].content || "";
          processedMessages[i].content = (oldContent ? oldContent + "\n\n" : "") + toolsPrompt;
          systemFound = true;
          break;
        }
      }
      if (!systemFound) {
        processedMessages.unshift({ role: "system", content: toolsPrompt });
      }
    }

    const prompt = parseOpenAIMessages(processedMessages);
    if (!prompt) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Empty prompt after extraction", type: "invalid_request" },
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: DEEPSEEK_COMPLETION_URL, headers: {}, transformedBody: body };
    }

    let token;
    try {
      token = await this.getOrRefreshToken(username, password);
    } catch (err) {
      log?.error?.("DEEPSEEK-FREE", `Auth failed: ${err.message}`);
      const errResp = new Response(JSON.stringify({
        error: { message: `DeepSeek Authentication failed: ${err.message}`, type: "auth_error" },
      }), { status: 401, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: DEEPSEEK_COMPLETION_URL, headers: {}, transformedBody: body };
    }

    const makeAttempt = async (useToken, forceRefresh = false) => {
      let activeToken = useToken;
      if (forceRefresh) {
        activeToken = await this.getOrRefreshToken(username, password, true);
      }

      const sessionId = await this.createSession(activeToken);
      const powHeader = await this.getAndSolvePow(activeToken, signal);

      const modelType = model === "deepseek-reasoner" ? "expert" : "default";
      const thinkingEnabled = model === "deepseek-reasoner";

      const payload = {
        chat_session_id: sessionId,
        model_type: modelType,
        parent_message_id: null,
        prompt: prompt,
        ref_file_ids: [],
        thinking_enabled: thinkingEnabled,
        search_enabled: false,
      };

      const headers = {
        ...DEEPSEEK_BASE_HEADERS,
        authorization: `Bearer ${activeToken}`,
        "x-ds-pow-response": powHeader,
      };

      log?.info?.("DEEPSEEK-FREE", `Querying ${model} (type=${modelType}, len=${prompt.length})`);
      const response = await fetch(DEEPSEEK_COMPLETION_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal,
      });

      return { response, headers, payload, activeToken };
    };

    let attempt;
    try {
      attempt = await makeAttempt(token, false);
      
      // If token expired, retry once with refreshed token
      if (attempt.response.status === 401 || attempt.response.status === 403) {
        log?.warn?.("DEEPSEEK-FREE", "Token unauthorized (401/403), retrying with fresh login...");
        attempt = await makeAttempt(token, true);
      }
    } catch (err) {
      log?.error?.("DEEPSEEK-FREE", `Execution failed: ${err.message}`);
      const errResp = new Response(JSON.stringify({
        error: { message: `DeepSeek Free execution error: ${err.message}`, type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: DEEPSEEK_COMPLETION_URL, headers: {}, transformedBody: body };
    }

    if (!attempt.response.ok) {
      const status = attempt.response.status;
      const errMsg = `DeepSeek Free upstream returned HTTP ${status}`;
      log?.warn?.("DEEPSEEK-FREE", errMsg);
      const errResp = new Response(JSON.stringify({
        error: { message: errMsg, type: "upstream_error", code: `HTTP_${status}` },
      }), { status, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: DEEPSEEK_COMPLETION_URL, headers: attempt.headers, transformedBody: attempt.payload };
    }

    if (!attempt.response.body) {
      const errResp = new Response(JSON.stringify({
        error: { message: "DeepSeek Free returned empty body", type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: DEEPSEEK_COMPLETION_URL, headers: attempt.headers, transformedBody: attempt.payload };
    }

    const cid = `chatcmpl-dsf-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);
    const thinkingEnabled = model === "deepseek-reasoner";

    let finalResponse;
    if (stream) {
      const sseStream = buildStreamingResponse(attempt.response.body, model, cid, created, thinkingEnabled, body.tools, signal);
      finalResponse = new Response(sseStream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" },
      });
    } else {
      finalResponse = await buildNonStreamingResponse(attempt.response.body, model, cid, created, thinkingEnabled, body.tools, signal);
    }

    return { response: finalResponse, url: DEEPSEEK_COMPLETION_URL, headers: attempt.headers, transformedBody: attempt.payload };
  }
}

export default DeepSeekFreeExecutor;
