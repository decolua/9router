import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { findDeepSeekPowNonce } from "../lib/deepseek-pow-hash.js";
import {
  hasTools,
  buildToolSystemPrompt,
  renderSpecialMessages,
  parseToolCallReply,
  emitToolCallChunks,
  buildToolCallResponse,
} from "./deepseekWebToolBridge.js";

const DEEPSEEK_WEB_BASE = "https://chat.deepseek.com";
const DEEPSEEK_API_BASE = `${DEEPSEEK_WEB_BASE}/api`;
const COMPLETION_URL = `${DEEPSEEK_API_BASE}/v0/chat/completion`;

const FAKE_HEADERS = {
  Accept: "*/*",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: DEEPSEEK_WEB_BASE,
  Referer: `${DEEPSEEK_WEB_BASE}/`,
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
  "X-Client-Bundle-Id": "com.deepseek.chat",
  "X-Client-Locale": "en-US",
  "X-Client-Platform": "web",
  "X-Client-Version": "2.0.0",
};

const tokenCache = new Map();
const sessionCache = new Map();
const CACHE_MAX_SIZE = 100;

function evictOldest(cache) {
  if (cache.size >= CACHE_MAX_SIZE) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
}

export function extractUserToken(raw) {
  if (!raw) return null;
  let str = String(raw).trim();
  try {
    const parsed = JSON.parse(str);
    if (typeof parsed?.value === "string") return parsed.value.trim();
  } catch {}
  if (str.includes("userToken=")) {
    const m = str.match(/userToken=([^;]+)/);
    if (m) str = m[1].trim();
  }
  if (str.startsWith("Bearer ")) str = str.slice(7).trim();
  str = str.replace(/^["']|["']$/g, "").trim();
  return str || null;
}

function errorResponse(status, message, dsCode) {
  return new Response(
    JSON.stringify({
      error: { message, type: "upstream_error", code: dsCode ?? `HTTP_${status}` },
    }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

function isThinkingModel(model) {
  const m = String(model || "").toLowerCase();
  return m.includes("think") || m.includes("r1") || m.includes("reason");
}

function isSearchModel(model) {
  const m = String(model || "").toLowerCase();
  return m.includes("search") || m.includes("fold");
}

function cleanDeepSeekToken(text) {
  return String(text || "").replace(/FINISHED/g, "").replace(/^(SEARCH|WEB_SEARCH|SEARCHING)\s*/i, "");
}

function formatStreamContent(raw, model) {
  let text = cleanDeepSeekToken(raw);
  if (!isSearchModel(model)) return text;
  if (String(model || "").toLowerCase().includes("search-silent")) {
    return text.replace(/\[citation:(\d+)\]/g, "");
  }
  return text.replace(/\[citation:(\d+)\]/g, "[$1]");
}

function appendSearchCitations(searchResults, model) {
  if (!searchResults || searchResults.length === 0 || String(model || "").toLowerCase().includes("search-silent")) {
    return "";
  }
  return searchResults
    .filter((r) => r.cite_index)
    .sort((a, b) => (a.cite_index || 0) - (b.cite_index || 0))
    .map((r) => `[${r.cite_index}]: [${r.title}](${r.url})`)
    .join("\n");
}

function createFinishOnceGuard(finish) {
  let streamFinished = false;
  return {
    finishOnce: () => {
      if (streamFinished) return;
      streamFinished = true;
      try {
        finish();
      } catch {}
    },
    hasFinished: () => streamFinished,
  };
}

function createFinishedDrainScheduler(finishStream, drainMs = 750) {
  let finishedDrainTimer = null;
  const clearFinishedDrain = () => {
    if (finishedDrainTimer) {
      clearTimeout(finishedDrainTimer);
      finishedDrainTimer = null;
    }
  };
  const scheduleFinishAfterDrain = () => {
    clearFinishedDrain();
    finishedDrainTimer = setTimeout(() => {
      finishedDrainTimer = null;
      finishStream();
    }, drainMs);
  };
  return {
    scheduleFinishAfterDrain,
    clearFinishedDrain,
    isDrainPending: () => finishedDrainTimer !== null,
  };
}

function resolveModelOptions(model, bodyObj) {
  const m = (model || "").toLowerCase();
  const modelType = m.includes("pro") || m.includes("expert") ? "expert" : "default";
  const thinkingEnabled =
    m.includes("r1") ||
    m.includes("think") ||
    m.includes("reason") ||
    bodyObj?.thinking_enabled === true ||
    bodyObj?.thinking === true ||
    !!bodyObj?.reasoning_effort;
  const searchEnabled =
    m.includes("search") ||
    bodyObj?.search_enabled === true ||
    bodyObj?.search === true ||
    bodyObj?.web_search === true;
  return { modelType, thinkingEnabled, searchEnabled };
}

function generateFakeCookie() {
  const ts = Date.now();
  const hex = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  const uid = () =>
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  return `intercom-HWWAFSESTIME=${ts}; HWWAFSESID=${hex(18)}; Hm_lvt_${uid()}=${Math.floor(ts / 1000)}; _frid=${uid()}`;
}

async function solvePow(challenge, signal) {
  const { algorithm, challenge: challengeStr, salt, difficulty, expire_at, signature, target_path } = challenge;
  if (algorithm !== "DeepSeekHashV1") throw new Error(`Unsupported PoW algorithm: ${algorithm}`);
  const prefix = `${salt}_${expire_at}_`;
  const answer = findDeepSeekPowNonce(prefix, challengeStr.toLowerCase(), difficulty);
  if (answer < 0) throw new Error("PoW solver failed");
  return Buffer.from(
    JSON.stringify({
      algorithm,
      challenge: challengeStr,
      salt,
      answer,
      signature,
      target_path,
    })
  ).toString("base64");
}

function transformSSE(deepseekStream, model) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const streamModel = model || "deepseek-web";
  const id = `chatcmpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = Math.floor(Date.now() / 1000);
  let emittedRole = false;
  let currentPath = "";
  const thinkingModel = isThinkingModel(streamModel);
  const searchResults = [];

  return new ReadableStream(
    {
      async start(controller) {
        const reader = deepseekStream.getReader();
        let buffer = "";

        const emit = (obj) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        };

        const chunk = (delta, finish) => {
          emit({
            id,
            object: "chat.completion.chunk",
            created,
            model: streamModel,
            choices: [{ index: 0, delta, finish_reason: finish ?? null }],
          });
        };

        const ensureRole = () => {
          if (!emittedRole) {
            emittedRole = true;
            chunk({ role: "assistant", content: "" });
          }
        };

        const { finishOnce: finishStream, hasFinished } = createFinishOnceGuard(() => {
          const citations = appendSearchCitations(searchResults, streamModel);
          if (citations) {
            ensureRole();
            chunk({ content: `\n\n${citations}` });
          }
          ensureRole();
          chunk({}, "stop");
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        });

        const { scheduleFinishAfterDrain, clearFinishedDrain, isDrainPending } =
          createFinishedDrainScheduler(finishStream);

        const sendByPath = (raw) => {
          const text = formatStreamContent(raw, streamModel);
          if (!text) return;
          ensureRole();
          let path = currentPath;
          if (!path && thinkingModel) path = "thinking";
          else if (!path && isSearchModel(streamModel)) path = "content";
          if (path === "thinking") {
            chunk({ reasoning_content: text });
          } else {
            chunk({ content: text });
          }
        };

        const applyFragmentType = (frag) => {
          const type = String(frag?.type || "").toUpperCase();
          if (type === "THINK") currentPath = "thinking";
          else if (type === "ANSWER" || type === "RESPONSE") currentPath = "content";
        };

        const handleFragment = (frag, setPathFromType = false) => {
          if (setPathFromType) applyFragmentType(frag);
          if (typeof frag?.content !== "string" || frag.content.length === 0) return;
          if (!setPathFromType) {
            const type = String(frag?.type || "").toUpperCase();
            if (type === "THINK") currentPath = "thinking";
            else if (type === "ANSWER" || type === "RESPONSE") currentPath = "content";
          }
          sendByPath(frag.content);
        };

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (!line.startsWith("data: ") && !line.startsWith("data:")) continue;
              const payload = line.replace(/^data:\s*/, "").trim();

              if (payload === "[DONE]") {
                finishStream();
                return;
              }

              let data;
              try {
                data = JSON.parse(payload);
              } catch {
                continue;
              }

              const p = data?.p;
              const o = data?.o;
              const v = data?.v;

              if (v && typeof v === "object" && v.response) {
                if (v.response.thinking_enabled === true) currentPath = "thinking";
                else if (v.response.thinking_enabled === false) currentPath = "content";
                const fragments = v.response.fragments;
                if (Array.isArray(fragments)) {
                  for (const frag of fragments) handleFragment(frag, false);
                }
              }

              if (p === "response/fragments") {
                if (Array.isArray(v)) {
                  for (const frag of v) handleFragment(frag, true);
                } else if (v && typeof v === "object") {
                  handleFragment(v, true);
                }
              }

              if (p === "response" && Array.isArray(v)) {
                for (const entry of v) {
                  if (entry?.p === "response" && entry?.v?.thinking_enabled === true) {
                    currentPath = "thinking";
                  }
                }
              }

              if (p === "response/search_status") continue;

              if (p === "response/search_results" && Array.isArray(v)) {
                if (o !== "BATCH") {
                  searchResults.length = 0;
                  searchResults.push(...v);
                } else {
                  for (const op of v) {
                    const match = String(op?.p || "").match(/^(\d+)\/cite_index$/);
                    if (match) {
                      const index = parseInt(match[1], 10);
                      if (searchResults[index]) searchResults[index].cite_index = op.v;
                    }
                  }
                }
                continue;
              }

              if (typeof v === "string") {
                sendByPath(v);
              } else if (Array.isArray(v) && p === "response") {
                for (const entry of v) {
                  if (Array.isArray(entry?.v)) {
                    const joined = entry.v.map((item) => item?.content || "").join("");
                    if (joined) sendByPath(joined);
                  }
                }
              }

              if (p === "response/status" && v === "FINISHED") {
                scheduleFinishAfterDrain();
                continue;
              }

              if (isDrainPending()) {
                scheduleFinishAfterDrain();
              }
            }
          }
        } catch (err) {
          clearFinishedDrain();
          if (!hasFinished()) {
            controller.error(err);
          }
          return;
        }

        finishStream();
      },
      cancel() {},
    },
    { highWaterMark: 16384 }
  );
}

async function collectSSEContent(deepseekStream, model) {
  const decoder = new TextDecoder();
  const reader = deepseekStream.getReader();
  let buffer = "";
  let content = "";
  let reasoningContent = "";
  let currentPath = "";
  const streamModel = model || "deepseek-web";
  const thinkingModel = isThinkingModel(streamModel);
  const searchResults = [];

  const appendByPath = (raw) => {
    const text = formatStreamContent(raw, streamModel);
    if (!text) return;
    let path = currentPath;
    if (!path && thinkingModel) path = "thinking";
    else if (!path && isSearchModel(streamModel)) path = "content";
    if (path === "thinking") reasoningContent += text;
    else content += text;
  };

  const applyFragmentType = (frag) => {
    const type = String(frag?.type || "").toUpperCase();
    if (type === "THINK") currentPath = "thinking";
    else if (type === "ANSWER" || type === "RESPONSE") currentPath = "content";
  };

  const handleFragment = (frag, setPathFromType = false) => {
    if (setPathFromType) applyFragmentType(frag);
    if (typeof frag?.content !== "string" || frag.content.length === 0) return;
    if (!setPathFromType) {
      const type = String(frag?.type || "").toUpperCase();
      if (type === "THINK") currentPath = "thinking";
      else if (type === "ANSWER" || type === "RESPONSE") currentPath = "content";
    }
    appendByPath(frag.content);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ") && !line.startsWith("data:")) continue;
      const payload = line.replace(/^data:\s*/, "").trim();
      try {
        const data = JSON.parse(payload);
        const p = data?.p;
        const v = data?.v;

        if (v && typeof v === "object" && v.response) {
          if (v.response.thinking_enabled === true) currentPath = "thinking";
          else if (v.response.thinking_enabled === false) currentPath = "content";
          if (Array.isArray(v.response.fragments)) {
            for (const frag of v.response.fragments) handleFragment(frag, false);
          }
        }

        if (p === "response/fragments") {
          if (Array.isArray(v)) {
            for (const frag of v) handleFragment(frag, true);
          } else if (v && typeof v === "object") {
            handleFragment(v, true);
          }
        }

        if (p === "response" && Array.isArray(v)) {
          for (const entry of v) {
            if (entry?.p === "response" && entry?.v?.thinking_enabled === true) {
              currentPath = "thinking";
            }
          }
        }

        if (p === "response/search_status") continue;

        if (p === "response/search_results" && Array.isArray(v)) {
          if (data?.o !== "BATCH") {
            searchResults.length = 0;
            searchResults.push(...v);
          } else {
            for (const op of v) {
              const match = String(op?.p || "").match(/^(\d+)\/cite_index$/);
              if (match) {
                const index = parseInt(match[1], 10);
                if (searchResults[index]) searchResults[index].cite_index = op.v;
              }
            }
          }
          continue;
        }

        if (typeof v === "string") {
          appendByPath(v);
        } else if (Array.isArray(v) && p === "response") {
          for (const entry of v) {
            if (Array.isArray(entry?.v)) {
              const joined = entry.v.map((item) => item?.content || "").join("");
              if (joined) appendByPath(joined);
            }
          }
        }
      } catch {}
    }
  }

  const citations = appendSearchCitations(searchResults, streamModel);
  if (citations) content += `\n\n${citations}`;

  return { content, reasoningContent };
}

function extractMessageText(content) {
  if (Array.isArray(content)) {
    return content.filter((c) => c.type === "text").map((c) => String(c.text || "")).join("\n");
  }
  return String(content || "");
}

const DEFAULT_AUTO_HISTORY_WINDOW = 20;

export function messagesToPrompt(messages, historyWindow = 0) {
  if (!messages || messages.length === 0) return "";
  const systemParts = [];
  const conversation = [];
  let lastUserContent = "";

  for (const m of messages) {
    const text = extractMessageText(m.content).trim();
    if (m.role === "system" || m.role === "developer") {
      if (text) systemParts.push(text);
    } else if (m.role === "user" || m.role === "assistant") {
      if (text) conversation.push({ role: m.role, text });
      if (m.role === "user") lastUserContent = text;
    } else if (m.role === "tool") {
      if (text) conversation.push({ role: "tool", text: `(${m.name || "tool"}) ${text}` });
    }
  }

  const parts = [];
  if (systemParts.length > 0) parts.push(systemParts.join("\n\n"));

  const effectiveWindow =
    historyWindow > 0 ? historyWindow : conversation.length > 1 ? DEFAULT_AUTO_HISTORY_WINDOW : 0;

  if (effectiveWindow > 0 && conversation.length > 1) {
    const recent = conversation.slice(-effectiveWindow);
    const transcript = recent
      .map((turn) =>
        turn.role === "assistant"
          ? `Assistant: ${turn.text}`
          : turn.role === "tool"
            ? `Tool result ${turn.text}`
            : `User: ${turn.text}`
      )
      .join("\n\n");
    parts.push(transcript);
  } else if (lastUserContent) {
    parts.push(lastUserContent);
  }

  return parts.join("\n\n").replace(/!\[.*?\]\(.*?\)/g, "");
}

async function acquireAccessToken(userToken, signal, log) {
  const cached = tokenCache.get(userToken);
  if (cached && cached.expiresAt > Math.floor(Date.now() / 1000)) {
    return cached.accessToken;
  }

  log?.info?.("DEEPSEEK-WEB", "Acquiring access token from /users/current...");
  const resp = await fetch(`${DEEPSEEK_API_BASE}/v0/users/current`, {
    headers: {
      Authorization: `Bearer ${userToken}`,
      ...FAKE_HEADERS,
    },
    signal: signal ?? undefined,
  });

  if (resp.status === 401 || resp.status === 403) {
    throw new Error("Token invalid or expired. Get a new userToken from DeepSeek localStorage");
  }
  if (!resp.ok) throw new Error(`users/current HTTP ${resp.status}`);

  const json = await resp.json();
  if (json?.code && json.code !== 0) {
    const errMsg = json.msg || json?.data?.biz_msg || `error code ${json.code}`;
    tokenCache.delete(userToken);
    throw new Error(`DeepSeek rejected token: ${errMsg}`);
  }
  const bizData = json?.data?.biz_data || json?.biz_data;
  if (!bizData?.token) {
    const errMsg = json?.msg || json?.data?.biz_msg || "Unknown error";
    throw new Error(`Failed to acquire token: ${errMsg}`);
  }

  const accessToken = bizData.token;
  evictOldest(tokenCache);
  tokenCache.set(userToken, {
    accessToken,
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  });

  log?.info?.("DEEPSEEK-WEB", `Access token acquired (${accessToken.length} chars)`);
  return accessToken;
}

function parseDeepSeekErrorPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const code = typeof payload.code === "number" ? payload.code : undefined;
  const msg = payload.msg;
  const bizMsg = payload.data?.biz_msg;
  const messageRaw = typeof msg === "string" ? msg : typeof bizMsg === "string" ? bizMsg : "";
  if (code !== undefined && code !== 0) {
    return { code, message: messageRaw || `DeepSeek error ${code}` };
  }
  return null;
}

async function createSession(accessToken, signal) {
  const resp = await fetch(`${DEEPSEEK_API_BASE}/v0/chat_session/create`, {
    method: "POST",
    headers: {
      ...FAKE_HEADERS,
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      Cookie: generateFakeCookie(),
    },
    body: JSON.stringify({}),
    signal: signal ?? undefined,
  });

  if (!resp.ok) throw new Error(`chat_session/create HTTP ${resp.status}`);
  const json = await resp.json();
  const bizData = json?.data?.biz_data || json?.biz_data;
  const id = bizData?.chat_session?.id;
  if (!id) throw new Error(`No session id: code=${json?.code}`);
  return id;
}

async function deleteSessionOnDeepSeek(accessToken, sessionId) {
  try {
    await fetch(`${DEEPSEEK_API_BASE}/v0/chat_session/delete`, {
      method: "POST",
      headers: {
        ...FAKE_HEADERS,
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ chat_session_id: sessionId }),
    });
  } catch {}
}

function wrapStreamWithCleanup(responseStream, cleanup) {
  const reader = responseStream.getReader();
  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        cleanup().catch(() => {});
        return;
      }
      controller.enqueue(value);
    },
    cancel() {
      reader.cancel();
      cleanup().catch(() => {});
    },
  });
}

async function getPowChallenge(accessToken, signal) {
  const resp = await fetch(`${DEEPSEEK_API_BASE}/v0/chat/create_pow_challenge`, {
    method: "POST",
    headers: {
      ...FAKE_HEADERS,
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ target_path: "/api/v0/chat/completion" }),
    signal: signal ?? undefined,
  });
  if (!resp.ok) throw new Error(`create_pow_challenge HTTP ${resp.status}`);
  const json = await resp.json();
  const bizData = json?.data?.biz_data || json?.biz_data;
  if (!bizData?.challenge?.challenge) throw new Error(`No PoW challenge: code=${json?.code}`);
  return bizData.challenge;
}

export class DeepSeekWebExecutor extends BaseExecutor {
  constructor() {
    super("deepseek-web", { baseUrl: DEEPSEEK_WEB_BASE });
  }

  async execute({ model, body, stream, credentials, signal, log }) {
    const bodyObj = body || {};
    const messages = Array.isArray(bodyObj.messages) ? bodyObj.messages : [];
    const rawCreds = credentials || {};
    const userToken = extractUserToken(rawCreds.apiKey || rawCreds.token);

    if (!userToken) {
      return {
        response: errorResponse(
          400,
          "Invalid credentials: paste your userToken from DeepSeek localStorage (DevTools -> Application -> Local Storage -> chat.deepseek.com -> userToken)"
        ),
        url: COMPLETION_URL,
        headers: {},
        transformedBody: body,
      };
    }

    const { modelType, thinkingEnabled, searchEnabled } = resolveModelOptions(model, bodyObj);
    const psd = rawCreds.providerSpecificData || {};
    const persistSession = psd.persistSession === true;
    const historyWindow = typeof psd.historyWindow === "number" && psd.historyWindow > 0 ? psd.historyWindow : 0;

    try {
      const accessToken = await acquireAccessToken(userToken, signal, log);
      const toolMode = hasTools(bodyObj);
      const toolPrompt = toolMode ? buildToolSystemPrompt(bodyObj.tools) : "";

      // Special turns (assistant tool_calls, tool results) become transcript
      // lines; the model reasons over them like a normal conversation.
      const specialTurns = toolMode ? renderSpecialMessages(messages) : [];

      const prompt = messagesToPrompt(
        toolMode
          ? [
              ...(toolPrompt ? [{ role: "system", content: toolPrompt }] : []),
              ...messages.filter((m) => m.role !== "tool" && !(m.role === "assistant" && Array.isArray(m.tool_calls))),
              ...specialTurns.map((t) => ({ role: t.role, content: t.text })),
            ]
          : messages,
        historyWindow
      );
      const refFileIds = Array.isArray(bodyObj.ref_file_ids) ? bodyObj.ref_file_ids : [];

      const performCompletion = async (sid) => {
        const powChallenge = await getPowChallenge(accessToken, signal);
        const powAnswer = await solvePow(powChallenge, signal);
        const reqHeaders = {
          ...FAKE_HEADERS,
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          "X-Ds-Pow-Response": powAnswer,
          "X-Client-Timezone-Offset": String(new Date().getTimezoneOffset() * -60),
          Cookie: generateFakeCookie(),
        };
        const requestPayload = {
          chat_session_id: sid,
          parent_message_id: null,
          model_type: modelType,
          prompt,
          ref_file_ids: refFileIds,
          thinking_enabled: thinkingEnabled,
          search_enabled: searchEnabled,
          preempt: false,
        };
        const resp = await fetch(COMPLETION_URL, {
          method: "POST",
          headers: reqHeaders,
          body: JSON.stringify(requestPayload),
          signal: signal ?? undefined,
        });
        return { resp, reqHeaders, requestPayload };
      };

      const acquireSession = async () => {
        if (persistSession) {
          const cached = sessionCache.get(userToken);
          if (cached) return { sessionId: cached.sessionId, reused: true };
          const created = await createSession(accessToken, signal);
          evictOldest(sessionCache);
          sessionCache.set(userToken, { sessionId: created, createdAt: Date.now() });
          return { sessionId: created, reused: false };
        }
        return { sessionId: await createSession(accessToken, signal), reused: false };
      };

      let { sessionId, reused: reusedSession } = await acquireSession();
      log?.info?.("DEEPSEEK-WEB", `POST ${COMPLETION_URL}`);
      let { resp, reqHeaders, requestPayload } = await performCompletion(sessionId);

      if (!resp.ok && persistSession && reusedSession) {
        log?.warn?.("DEEPSEEK-WEB", "Reused session failed, retrying with fresh session");
        sessionCache.delete(userToken);
        sessionId = await createSession(accessToken, signal);
        evictOldest(sessionCache);
        sessionCache.set(userToken, { sessionId, createdAt: Date.now() });
        reusedSession = false;
        ({ resp, reqHeaders, requestPayload } = await performCompletion(sessionId));
      }

      if (!resp.ok) {
        const status = resp.status;
        let errMsg = `DeepSeek API error (${status})`;
        if (status === 401 || status === 403) {
          tokenCache.delete(userToken);
          errMsg = "DeepSeek token expired. Get a fresh userToken from localStorage.";
        } else if (status === 429) {
          errMsg = "DeepSeek rate limited. Wait and retry.";
        }
        try {
          const errBody = await resp.json();
          if (errBody?.code && errBody.code !== 0) {
            errMsg = `DeepSeek error ${errBody.code}: ${errBody.msg}`;
          }
        } catch {}

        if (persistSession) sessionCache.delete(userToken);
        deleteSessionOnDeepSeek(accessToken, sessionId).catch(() => {});
        return {
          response: errorResponse(status, errMsg),
          url: COMPLETION_URL,
          headers: reqHeaders,
          transformedBody: requestPayload,
        };
      }

      const ct = resp.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        try {
          const json = await resp.json();
          const parsed = parseDeepSeekErrorPayload(json);
          if (parsed) {
            const errMsg = `DeepSeek error ${parsed.code}: ${parsed.message}`;
            const status = parsed.code === 40003 ? 401 : parsed.code === 40002 ? 429 : 502;
            if (parsed.code === 40003) tokenCache.delete(userToken);
            if (persistSession) sessionCache.delete(userToken);
            deleteSessionOnDeepSeek(accessToken, sessionId).catch(() => {});
            return {
              response: errorResponse(status, errMsg, parsed.code),
              url: COMPLETION_URL,
              headers: reqHeaders,
              transformedBody: requestPayload,
            };
          }
          if (!persistSession) deleteSessionOnDeepSeek(accessToken, sessionId).catch(() => {});
          return {
            response: new Response(JSON.stringify(json), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
            url: COMPLETION_URL,
            headers: reqHeaders,
            transformedBody: requestPayload,
          };
        } catch {}
      }

      const cleanupFn = persistSession
        ? async () => {}
        : () => deleteSessionOnDeepSeek(accessToken, sessionId);

      const clientModel = typeof model === "string" && model.trim() ? model.trim() : "deepseek-web";

      if (stream !== false) {
        if (toolMode) {
          // Buffer the model's full answer, then translate a detected tool
          // call into OpenAI tool_calls deltas (RAG web backend only speaks
          // text, so calls can only be classified once the answer completes).
          const { content, reasoningContent } = await collectSSEContent(resp.body, clientModel);
          const parsed = parseToolCallReply(content);
          await cleanupFn();

          const encoder = new TextEncoder();
          const id = `chatcmpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const created = Math.floor(Date.now() / 1000);
          let roleEmitted = false;
          const outStream = new ReadableStream({
            start(controller) {
              const emit = (obj) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
              const chunk = (delta, finish) => emit({ id, object: "chat.completion.chunk", created, model: clientModel, choices: [{ index: 0, delta, finish_reason: finish ?? null }] });
              const ensureRole = () => { if (!roleEmitted) { roleEmitted = true; chunk({ role: "assistant", content: "" }); } };

              if (parsed.calls.length > 0) {
                if (parsed.content) {
                  ensureRole();
                  chunk({ content: parsed.content });
                }
                if (reasoningContent) chunk({ reasoning_content: reasoningContent });
                if (emitToolCallChunks(chunk, ensureRole, parsed.calls)) {
                  controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                  controller.close();
                  return;
                }
              }

              ensureRole();
              if (parsed.content) chunk({ content: parsed.content });
              if (reasoningContent) chunk({ reasoning_content: reasoningContent });
              chunk({}, "stop");
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            },
          });
          return {
            response: new Response(outStream, {
              status: 200,
              headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
            }),
            url: COMPLETION_URL,
            headers: reqHeaders,
            transformedBody: requestPayload,
          };
        }

        const openaiStream = transformSSE(resp.body, clientModel);
        const wrappedStream = wrapStreamWithCleanup(openaiStream, cleanupFn);
        return {
          response: new Response(wrappedStream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
          }),
          url: COMPLETION_URL,
          headers: reqHeaders,
          transformedBody: requestPayload,
        };
      }

      const { content, reasoningContent } = await collectSSEContent(resp.body, clientModel);
      await cleanupFn();

      if (toolMode) {
        const parsed = parseToolCallReply(content);
        if (parsed.calls.length > 0) {
          return {
            response: new Response(JSON.stringify(buildToolCallResponse({
              model: clientModel,
              messageText: parsed.content || null,
              calls: parsed.calls,
              reasoningContent,
            })), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
            url: COMPLETION_URL,
            headers: reqHeaders,
            transformedBody: requestPayload,
          };
        }
      }

      const message = { role: "assistant", content };
      if (reasoningContent) message.reasoning_content = reasoningContent;
      const openaiResponse = {
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: model || modelType,
        choices: [
          {
            index: 0,
            message,
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
      return {
        response: new Response(JSON.stringify(openaiResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
        url: COMPLETION_URL,
        headers: reqHeaders,
        transformedBody: requestPayload,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log?.error?.("DEEPSEEK-WEB", `Execute failed: ${msg}`);
      if (err instanceof Error && err.name === "AbortError") {
        return {
          response: errorResponse(499, "Request cancelled"),
          url: COMPLETION_URL,
          headers: {},
          transformedBody: body,
        };
      }
      return {
        response: errorResponse(502, `DeepSeek error: ${msg}`),
        url: COMPLETION_URL,
        headers: {},
        transformedBody: body,
      };
    }
  }
}
