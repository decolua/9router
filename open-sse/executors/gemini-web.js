// Gemini Web (cookie) executor.
//
// Model selection, wire format and the tool-calling bridge follow
// zexadev/gemini-web2api-go, which reverse-engineers the same browser endpoint
// we do. Three things matter and all three were wrong or missing before:
//
// 1. MODEL SELECTION. The server ignores inner[] mode slots when no model
//    header is sent: every request silently lands on 3.5 Flash-Lite. The only
//    switch it honours is x-goog-ext-525001261-jspb carrying the model hex.
//    So the model list below is keyed by hex, and every request sends the header.
//
// 2. EXTENDED THINKING. inner[80]=2 (plus header slot 15) turns on the web UI's
//    "extended thinking". It is ignored server-side while anonymous, so the
//    -thinking variants are gated behind a signed-in cookie the same way 3.1 Pro
//    and 3.8 Flash are.
//
// 3. TOOL CALLING. There is no protocol-level function calling upstream, so the
//    OpenAI `tools` array is encoded into the prompt and the reply parsed back
//    into standard tool_calls (see webCookieToolBridge.js). Previously this
//    executor answered 400 "Gemini Web does not support OpenAI function tools".

import { BaseExecutor } from "./base.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { createHash } from "node:crypto";
import { estimateInputTokens, estimateOutputTokens } from "../utils/usageTracking.js";
import { FORMATS } from "../translator/formats.js";
import {
  buildToolInstructions,
  buildToolReminder,
  emitToolCallChunks,
  extractText,
  hasTools,
  parseToolCallReply,
  renderToolTranscript,
  selectableTools,
} from "./webCookieToolBridge.js";

const GEMINI_URL = "https://gemini.google.com/app";
const STREAM_URL = "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate";

// Chrome 146 desktop, matching the Go client. The Linux-x86 string we used
// before is a plausible-but-wrong fingerprint for a headless box.
const GEMINI_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

const SEC_CH_UA = `"Chromium";v="146", "Google Chrome";v="146", "Not?A_Brand";v="24"`;

const DEFAULT_BL = "boq_assistant-bard-web-server_20260315.08_p0";

// inner array length. The browser sends 97-98 slots; a shorter array leaves no
// room for inner[80] (thinking) at all.
const INNER_SLOTS = 97;

// inner[80] / header slot 15: 1 = normal, 2 = extended thinking.
const THINKING_NORMAL = 1;
const THINKING_EXTENDED = 2;

// Server-side model ids, taken from the authoritative batchexecute?rpcids=otAQ7b
// listing. Hex ids rotate whenever Google swaps the served build, so these are
// re-read from the listing instead of being trusted forever; the aliases below
// keep the previous ids working.
export const HEX = {
  flashLite: "8c46e95b1a07cecc",
  flash: "56fdd199312815e2",
  pro: "e6fa609c3fa255c0",
  argon: "95a4c0abcba24364",
};

// Superseded ids still seen in older listings. Resolving one of these falls
// through to the model that replaced it.
export const LEGACY_HEX = {
  fbb127bbb056c959: "gemini-3.8-flash",
  cf41b0e0dd7d53e5: "gemini-3.5-flash-lite",
  "9d8ca3786ebdfbea": "gemini-3.1-pro",
};

export const HEX_TO_MODEL = {
  [HEX.flashLite]: "gemini-3.5-flash-lite",
  [HEX.flash]: "gemini-3.8-flash",
  [HEX.pro]: "gemini-3.1-pro",
  [HEX.argon]: "gemini-4-argon",
  ...LEGACY_HEX,
};

/**
 * Models the web endpoint actually serves.
 *
 * `mode` is the legacy inner[79] slot; the header's slot 14 carries the same
 * value and is what the server reads. Argon needs mode 8 - mode selects it, hex
 * alone returns Flash.
 *
 * `needsCookie` gates the models that are silently downgraded for an anonymous
 * or free account. We still list them (the executor returns a clear error when
 * the cookie cannot support them) because hiding them costs more than the
 * occasional downgrade report.
 */
export const GEMINI_WEB_MODELS = {
  "gemini-3.5-flash-lite": { hexID: HEX.flashLite, mode: 6, needsCookie: false },
  "gemini-3.8-flash": { hexID: HEX.flash, mode: 1, needsCookie: true },
  // Google renamed 3.7 to 3.8 in place; the hex is identical.
  "gemini-3.7-flash": { hexID: HEX.flash, mode: 1, needsCookie: true, aliasOf: "gemini-3.8-flash" },
  "gemini-3.6-flash": { hexID: HEX.flash, mode: 1, needsCookie: true, aliasOf: "gemini-3.8-flash" },
  "gemini-3.1-pro": { hexID: HEX.pro, mode: 3, needsCookie: true },
  "gemini-4-argon": { hexID: HEX.argon, mode: 8, needsCookie: true },
  // Extended thinking variants: orthogonal to the base models, so a
  // -thinking entry pairs with a base hex rather than being its own model.
  "gemini-3.5-flash-lite-thinking": { hexID: HEX.flashLite, mode: 6, thinking: true, needsCookie: true },
  "gemini-3.8-flash-thinking": { hexID: HEX.flash, mode: 1, thinking: true, needsCookie: true },
  "gemini-3.7-flash-thinking": { hexID: HEX.flash, mode: 1, thinking: true, needsCookie: true, aliasOf: "gemini-3.8-flash-thinking" },
  "gemini-3.6-flash-thinking": { hexID: HEX.flash, mode: 1, thinking: true, needsCookie: true, aliasOf: "gemini-3.8-flash-thinking" },
  "gemini-3.1-pro-thinking": { hexID: HEX.pro, mode: 3, thinking: true, needsCookie: true },
  "gemini-4-argon-thinking": { hexID: HEX.argon, mode: 8, thinking: true, needsCookie: true },
};

export const MODEL_ALIASES = {
  // Flash aliases
  "gemini-3.8-flash": "gemini-3.8-flash",
  "gemini-3.7-flash": "gemini-3.8-flash",
  "gemini-3.6-flash": "gemini-3.8-flash",
  "gemini-3.5-flash": "gemini-3.8-flash",
  "gemini-3-flash": "gemini-3.8-flash",
  "gemini-3.0-flash": "gemini-3.8-flash",
  "gemini-2.5-flash": "gemini-3.8-flash",
  "gemini-2.0-flash": "gemini-3.8-flash",
  "gemini-1.5-flash": "gemini-3.8-flash",
  "gemini-flash": "gemini-3.8-flash",
  flash: "gemini-3.8-flash",
  default: "gemini-3.8-flash",
  auto: "gemini-3.8-flash",

  // Flash Lite aliases
  "gemini-3.5-flash-lite": "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite": "gemini-3.5-flash-lite",
  "gemini-3-flash-lite": "gemini-3.5-flash-lite",
  "gemini-3.0-flash-lite": "gemini-3.5-flash-lite",
  "gemini-2.5-flash-lite": "gemini-3.5-flash-lite",
  "gemini-2.0-flash-lite": "gemini-3.5-flash-lite",
  "gemini-flash-lite": "gemini-3.5-flash-lite",
  "flash-lite": "gemini-3.5-flash-lite",

  // Pro aliases
  "gemini-3.1-pro": "gemini-3.1-pro",
  "gemini-3.5-pro": "gemini-3.1-pro",
  "gemini-3-pro": "gemini-3.1-pro",
  "gemini-3.0-pro": "gemini-3.1-pro",
  "gemini-2.5-pro": "gemini-3.1-pro",
  "gemini-2.0-pro": "gemini-3.1-pro",
  "gemini-1.5-pro": "gemini-3.1-pro",
  "gemini-pro": "gemini-3.1-pro",
  pro: "gemini-3.1-pro",

  // Argon aliases
  "gemini-4-argon": "gemini-4-argon",
  "gemini-argon": "gemini-4-argon",
  argon: "gemini-4-argon",
};

export const DEFAULT_MODEL = "gemini-3.8-flash";

export function resolveGeminiWebModel(model) {
  const rawId = String(model ?? "").trim();
  if (!rawId) return { ...GEMINI_WEB_MODELS[DEFAULT_MODEL], id: DEFAULT_MODEL, thinking: false };

  // Strip provider prefix if present ("gemini-web/gemini-3.8-flash", "gweb/pro", etc.)
  let id = rawId.includes("/") ? rawId.slice(rawId.lastIndexOf("/") + 1).trim() : rawId;
  if (!id) id = DEFAULT_MODEL;

  const lower = id.toLowerCase();
  const isThinking = lower.endsWith("-thinking") || lower.endsWith(":thinking") || lower.endsWith("-think") || lower.endsWith(":think");
  const baseName = isThinking ? lower.replace(/[-:](?:thinking|think)$/, "") : lower;

  // 1. Direct hex lookup (active or superseded)
  if (HEX_TO_MODEL[baseName] || LEGACY_HEX[baseName]) {
    const targetModel = HEX_TO_MODEL[baseName] || LEGACY_HEX[baseName];
    const targetKey = isThinking ? `${targetModel}-thinking` : targetModel;
    const cfg = GEMINI_WEB_MODELS[targetKey] || GEMINI_WEB_MODELS[targetModel];
    return {
      thinking: isThinking || !!cfg?.thinking,
      mode: 1,
      needsCookie: true,
      ...cfg,
      id: isThinking ? `${targetModel}-thinking` : targetModel,
    };
  }

  // 2. Direct match in GEMINI_WEB_MODELS
  const exactKey = Object.keys(GEMINI_WEB_MODELS).find((k) => k.toLowerCase() === lower);
  if (exactKey) {
    const cfg = GEMINI_WEB_MODELS[exactKey];
    return { thinking: false, mode: 1, needsCookie: false, ...cfg, id: exactKey };
  }

  // 3. Match base in GEMINI_WEB_MODELS
  const baseExactKey = Object.keys(GEMINI_WEB_MODELS).find((k) => k.toLowerCase() === baseName);
  if (baseExactKey) {
    const baseCfg = GEMINI_WEB_MODELS[baseExactKey];
    const resolvedId = isThinking ? `${baseExactKey}-thinking` : baseExactKey;
    const thinkingCfg = isThinking ? GEMINI_WEB_MODELS[resolvedId] : null;
    return {
      ...baseCfg,
      ...(thinkingCfg || {}),
      id: resolvedId,
      thinking: isThinking || !!baseCfg.thinking,
    };
  }

  // 4. Model aliases map
  if (MODEL_ALIASES[baseName]) {
    const targetModel = MODEL_ALIASES[baseName];
    const targetKey = isThinking ? `${targetModel}-thinking` : targetModel;
    const cfg = GEMINI_WEB_MODELS[targetKey] || GEMINI_WEB_MODELS[targetModel];
    return {
      ...cfg,
      id: targetKey,
      thinking: isThinking || !!cfg?.thinking,
    };
  }

  // 5. Raw 16-hex ID passthrough
  if (/^[0-9a-f]{16}$/i.test(baseName)) {
    return {
      id: isThinking ? `${baseName}-thinking` : baseName,
      hexID: baseName.toLowerCase(),
      mode: 1,
      thinking: isThinking,
      needsCookie: true,
      rawHex: true,
    };
  }

  // 6. Heuristic keyword fallback for model families
  let familyModel = null;
  if (baseName.includes("argon")) {
    familyModel = "gemini-4-argon";
  } else if (baseName.includes("lite")) {
    familyModel = "gemini-3.5-flash-lite";
  } else if (baseName.includes("pro")) {
    familyModel = "gemini-3.1-pro";
  } else if (baseName.includes("flash") || baseName.includes("gemini")) {
    familyModel = "gemini-3.8-flash";
  }

  if (familyModel) {
    const targetKey = isThinking ? `${familyModel}-thinking` : familyModel;
    const cfg = GEMINI_WEB_MODELS[targetKey] || GEMINI_WEB_MODELS[familyModel];
    return {
      ...cfg,
      id: targetKey,
      thinking: isThinking || !!cfg?.thinking,
      inferredFrom: id,
    };
  }

  // 7. Unknown model: send no header so the server picks its own default
  return { id, hexID: "", mode: 1, thinking: isThinking, needsCookie: false, unknown: true };
}

export function normalizeGeminiCookieInput(raw, cookieName = "__Secure-1PSID") {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      const cookies =
        parsed.cookies && typeof parsed.cookies === "object" && !Array.isArray(parsed.cookies)
          ? parsed.cookies
          : parsed;
      const pairs = Object.entries(cookies)
        .filter(([, v]) => typeof v === "string" && v.trim().length > 0)
        .map(([k, v]) => `${k}=${String(v).trim()}`);
      if (pairs.length > 0) return pairs.join("; ");
    } catch {}
  }
  return trimmed.includes("=") ? trimmed : `${cookieName}=${trimmed}`;
}

export function parseCookies(raw) {
  return String(raw || "")
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((part) => {
      const eq = part.indexOf("=");
      if (eq === -1) return null;
      const name = part.substring(0, eq).trim();
      const value = part.substring(eq + 1).trim();
      if (!name || !value) return null;
      if (["path", "domain", "expires", "max-age", "secure", "httponly", "samesite"].includes(name.toLowerCase())) {
        return null;
      }
      return { name, value };
    })
    .filter(Boolean);
}

function cookieValue(cookie, name) {
  for (const p of parseCookies(cookie)) {
    if (p.name === name) return p.value;
  }
  return "";
}

function uuid4() {
  const b = crypto.randomUUID();
  return b;
}

/**
 * x-goog-ext-525001261-jspb. Shape captured off a real browser session:
 *   [1,null,null,null,"<hex>",null,null,0,[4,5,6,8],null,null,1,null,null,<mode>,<think>,"<uuid>"]
 * Slot 14 mirrors inner[79] and slot 15 mirrors inner[80]; the SERVER reads the
 * header, so filling only the inner slots produces a normal answer with an empty
 * thinking chain.
 */
export function buildModelHeader(hexID, mode, think, uuid) {
  if (!hexID) return "";
  if (!uuid) return `[1,null,null,null,"${hexID}"]`;
  return `[1,null,null,null,"${hexID}",null,null,0,[4,5,6,8],null,null,1,null,null,${mode},${think},"${uuid}"]`;
}

/**
 * The batchexecute inner array. Slot values follow the browser capture; the ones
 * that matter are [0] prompt, [59] request uuid, [79] mode, [80] thinking.
 */
export function buildInnerPayload(prompt, { mode = 1, thinking = false, uuid = "", temporaryChat = false } = {}) {
  const inner = new Array(INNER_SLOTS).fill(null);
  inner[0] = [prompt, 0, null, null, null, null, 0];
  inner[1] = ["en"];
  inner[2] = ["", "", "", null, null, null, null, null, null, ""];
  inner[6] = [0];
  inner[7] = 1;
  inner[10] = 1;
  inner[11] = 0;
  // Turn index inside the web conversation. We open a new session every
  // request, so this is always 0.
  inner[17] = [[0]];
  inner[18] = 0;
  inner[27] = 1;
  inner[30] = [4];
  // Captured as [1] in every browser scenario (signed in, anonymous, thinking).
  inner[41] = [1];
  if (temporaryChat) inner[45] = 1;
  inner[53] = 0;
  inner[59] = uuid;
  inner[61] = [];
  inner[68] = 1;
  inner[79] = mode;
  inner[80] = thinking ? THINKING_EXTENDED : THINKING_NORMAL;
  inner[91] = 0;
  inner[96] = thinking ? 1 : 0;
  return JSON.stringify(inner);
}

export function buildGeminiPrompt(messages) {
  const textMessages = (messages || [])
    .map((m) => {
      const content = extractText(m?.content ?? "");
      return { role: m?.role || "user", content };
    })
    .filter((m) => m.content.trim().length > 0);
  const userMessages = textMessages.filter((m) => m.role === "user");
  const lastUser = userMessages[userMessages.length - 1];
  const lastUserContent = lastUser?.content ?? "";
  const lastUserIdx = lastUser ? textMessages.lastIndexOf(lastUser) : -1;
  const priorTurns = textMessages.filter(
    (m, i) => i < lastUserIdx && (m.role === "user" || m.role === "assistant")
  );
  const systemText = textMessages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  if (priorTurns.length === 0 && !systemText) return lastUserContent;
  if (priorTurns.length === 0) return `System:\n${systemText}\n\n${lastUserContent}`;
  const historyLines = priorTurns.map(
    (m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`
  );
  const parts = [];
  if (systemText) parts.push(`System:\n${systemText}`);
  parts.push(`Previous conversation:\n${historyLines.join("\n\n")}`);
  parts.push(`Current user message:\n${lastUserContent}`);
  return parts.join("\n\n");
}

/**
 * Assemble the prompt, injecting the tool protocol when the client sent tools.
 * Assistant tool_calls and tool results are folded in as readable transcript
 * lines so a multi-step agent loop stays coherent.
 */
export function buildPromptWithTools(messages, body, options = {}) {
  const toolMode = options.disableToolCalling ? false : hasTools(body);
  if (!toolMode) return { prompt: buildGeminiPrompt(messages), toolMode: false };
  const instructions = buildToolInstructions(body, "fenced");
  const { mode, forced } = selectableTools(body);
  const reminder = buildToolReminder("fenced", { mode, forced });
  const transcript = renderToolTranscript(messages, "fenced");
  const base = buildGeminiPrompt(messages);
  const parts = [];
  if (instructions) parts.push(instructions);
  parts.push(base);
  for (const t of transcript) parts.push(t.text);
  if (reminder) parts.push(reminder);
  return { prompt: parts.join("\n\n"), toolMode: true };
}

/**
 * Code-execution artifacts Gemini emits when it runs code instead of answering.
 * The fence carries an event index, e.g.
 *   ```python?code_reference&code_event_index=3
 * Strip them, but keep the code if stripping empties the answer - otherwise a
 * math answer that was entirely a code execution would read as an upstream
 * failure.
 */
const CODE_ARTIFACT_RE =
  /```(?:python|javascript|text)\?code_(?:reference|stdout)&code_event_index=\d+\n[\s\S]*?```\n?/g;
const CODE_MARKER_RE =
  /```(python|javascript|text)\?code_(?:reference|stdout)&code_event_index=\d+/g;

export function cleanGeminiText(text) {
  const raw = String(text ?? "");
  const cleaned = raw.replace(CODE_ARTIFACT_RE, "").trim();
  // If stripping left nothing, the whole reply WAS a code execution. Fall back
  // to degrading the marker to a normal fence instead of returning an empty
  // answer that reads like an upstream failure.
  if (!cleaned && raw.trim()) {
    return raw.replace(CODE_MARKER_RE, "```$1").trim();
  }
  return cleaned;
}

export function parseStreamResponse(raw) {
  const lines = String(raw || "").split("\n");
  let lastText = "";
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line === ")]}'" || /^\d+$/.test(line)) continue;
    if (!line.includes("wrb.fr")) continue;
    try {
      const arr = JSON.parse(line);
      if (!Array.isArray(arr) || !Array.isArray(arr[0]) || arr[0][0] !== "wrb.fr") continue;
      const payload = arr[0]?.[2];
      if (typeof payload !== "string") continue;
      const inner = JSON.parse(payload);
      const responseArray = inner?.[4]?.[0]?.[1];
      if (!Array.isArray(responseArray)) continue;
      const text = responseArray.filter((c) => typeof c === "string").join("");
      if (text) lastText = text;
    } catch {}
  }
  return lastText;
}

/**
 * Thinking chain, when the model is running with extended thinking enabled.
 * Slot path inner[4][0][37][0][0], taken from a capture. The longest chain in
 * the stream wins rather than the last: once the chain freezes, later frames
 * may omit or truncate that slot, so "last seen" loses text.
 */
export function parseStreamReasoning(raw) {
  const lines = String(raw || "").split("\n");
  let best = "";
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line === ")]}'" || /^\d+$/.test(line)) continue;
    if (!line.includes("wrb.fr") || line.length < 200) continue;
    try {
      const arr = JSON.parse(line);
      const first = Array.isArray(arr) ? arr[0] : null;
      if (!Array.isArray(first) || first[0] !== "wrb.fr") continue;
      const payload = first[2];
      if (typeof payload !== "string" || payload.length < 50) continue;
      const inner = JSON.parse(payload);
      const text = inner?.[4]?.[0]?.[37]?.[0]?.[0];
      if (typeof text === "string" && text.length > best.length) best = text;
    } catch {}
  }
  return cleanGeminiText(best);
}

/**
 * Session cache.
 *
 * `/app` answers with ~800KB of HTML and takes 30-60s from this box; without a
 * cache every single request pays that, and a "Test all models" run - which
 * fires one execute per model - serialises into timeouts even though each
 * individual model answers in 13-48s. The `at` token is a per-session XSRF
 * value, so it is safe to reuse until it is rejected; on rejection execute()
 * passes force=true to re-fetch once.
 */
const SESSION_TTL_MS = 10 * 60 * 1000;
const sessionCache = new Map(); // cookie -> { at, bl, expiresAt }

async function fetchSessionParams(cookie, force = false, proxyOptions = null) {
  const hit = sessionCache.get(cookie);
  const now = Date.now();
  if (!force && hit && hit.expiresAt > now) return { at: hit.at, bl: hit.bl };

  const res = await geminiFetch(GEMINI_URL, {
    headers: {
      Cookie: cookie,
      "User-Agent": GEMINI_USER_AGENT,
      Accept: "text/html",
      "Accept-Language": "en-US,en;q=0.9",
    },
  }, proxyOptions);
  if (!res.ok) return null;
  const html = await res.text();
  const m = html.match(/"SNlM0e":"([^"]+)"/) || html.match(/SNlM0e\\?":\\?"([^"\\]+)/);
  const bl = html.match(/"cfb2h":"([^"]+)"/) || html.match(/cfb2h\\?":\\?"([^"\\]+)/);
  if (!m) return null;
  const session = { at: m[1], bl: bl ? bl[1] : DEFAULT_BL };
  sessionCache.set(cookie, { ...session, expiresAt: Date.now() + SESSION_TTL_MS });
  return session;
}

function browserHeaders(cookie) {
  const h = {
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent": GEMINI_USER_AGENT,
    "Sec-CH-UA": SEC_CH_UA,
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": `"Windows"`,
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    Origin: "https://gemini.google.com",
    Referer: GEMINI_URL,
    "X-Same-Domain": "1",
    "X-Goog-AuthUser": "0",
    // The browser sends both on every request; values are fixed.
    "x-goog-ext-73010989-jspb": "[0]",
    "x-goog-ext-73010990-jspb": "[0,0,0]",
  };
  if (cookie) h.Cookie = cookie;
  return h;
}

function errorResponse(status, message) {
  return new Response(
    JSON.stringify({ error: { message, type: "upstream_error" } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

/**
 * `fetch failed` alone hides every actionable detail: undici puts the real
 * reason (ENOTFOUND, ECONNRESET, CERT_HAS_EXPIRED, ...) on err.cause. Without
 * it a dead egress IP and a mangled cookie look identical to the operator.
 */
function describeFetchError(err) {
  if (!(err instanceof Error)) return "unknown";
  const cause = err.cause;
  const detail = cause?.code || cause?.message;
  if (!detail) return err.message;
  return `${err.message} (${detail})`;
}

// Containers with a broken IPv6 route (Railway among them) fail the connect
// phase for hosts that advertise AAAA records, which surfaces as a bare
// "fetch failed" while the same request works from a laptop. Retrying once over
// IPv4 turns that deployment bug into a working request.
const IPV4_RETRY_CODES = new Set([
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EAI_AGAIN",
  "ENOTFOUND",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
]);
let ipv4Dispatcher = null;

async function ipv4Fetch(url, options) {
  if (!ipv4Dispatcher) {
    const { Agent } = await import("undici");
    ipv4Dispatcher = new Agent({ connect: { family: 4 } });
  }
  return fetch(url, { ...options, dispatcher: ipv4Dispatcher });
}

async function geminiFetch(url, options, proxyOptions) {
  try {
    return await proxyAwareFetch(url, options, proxyOptions);
  } catch (err) {
    const code = err?.cause?.code || err?.code;
    if (!IPV4_RETRY_CODES.has(code)) throw err;
    const proxied = proxyOptions?.connectionProxyUrl || proxyOptions?.url;
    if (proxied) throw err;
    return ipv4Fetch(url, options);
  }
}

/**
 * Read the Bard stream to completion - or to the first parseable answer.
 *
 * StreamGenerate is chunked and Google frequently never closes it: the probe
 * above showed a 186-byte handshake frame, then 45s of silence, then a byte,
 * with the connection staying open. `res.text()` waits for close and hangs
 * forever, which is why so many models "timed out" while the same request
 * succeeds minutes later. So we read incrementally and stop the moment the
 * accumulated buffer parses into a real answer, with two guard rails: 30s of
 * silence after the last byte, and a hard 150s ceiling (measured replies on this
 * box run 4-45s, but the same prompt has been observed at 108s).
 */
const END_FRAME_RE = /\[\["e",\d+/;

export async function readGeminiStream(res, externalSignal) {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let chunks = 0;
  const t0 = Date.now();
  const HARD_MS = 150000;
  const IDLE_MS = 30000;
  let lastData = Date.now();
  let gotFirst = false;
  try {
    while (true) {
      if (externalSignal?.aborted) break;
      const elapsed = Date.now() - t0;
      if (elapsed > HARD_MS) break;
      if (gotFirst && Date.now() - lastData > IDLE_MS) break;
      const r = await reader.read();
      if (r.done) break;
      chunks++;
      lastData = Date.now();
      gotFirst = true;
      buf += decoder.decode(r.value, { stream: true });
      // Each mid-stream frame carries the answer so far, so parsing the first
      // parseable frame returns a half-written reply - and cut tool-call JSON in
      // half. Read until Google sends its terminal `["e",...]` frame instead.
      if (END_FRAME_RE.test(buf)) break;
    }
  } catch {
    // Timeout/abort below: whatever accumulated is what we can use.
  } finally {
    try { reader.cancel(); } catch {}
  }
  return buf;
}

export class GeminiWebExecutor extends BaseExecutor {
  constructor() {
    super("gemini-web", { baseUrl: GEMINI_URL });
  }

  async testConnection(credentials) {
    try {
      const raw = credentials?.apiKey || credentials?.cookie || "";
      const cookie = normalizeGeminiCookieInput(raw);
      if (!cookie) return false;
      return parseCookies(cookie).some((p) => p.value.length > 0);
    } catch {
      return false;
    }
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const bodyObj = body || {};
    const rawCreds = credentials || {};
    const cookie = normalizeGeminiCookieInput(rawCreds.apiKey || rawCreds.cookie || "");
    if (!cookie) {
      return {
        response: errorResponse(401, "Missing Gemini cookies (__Secure-1PSID)"),
        url: GEMINI_URL,
        headers: {},
        transformedBody: body,
      };
    }

    const modelCfg = resolveGeminiWebModel(model || bodyObj.model);
    const modelId = modelCfg.id;

    let prompt;
    let toolMode = false;
    let messages = Array.isArray(bodyObj.messages) ? [...bodyObj.messages] : [];
    if (messages.length === 0 && (typeof bodyObj.prompt === "string" || Array.isArray(bodyObj.prompt))) {
      const promptText = typeof bodyObj.prompt === "string" ? bodyObj.prompt : extractText(bodyObj.prompt);
      if (promptText.trim().length > 0) {
        messages = [{ role: "user", content: promptText }];
      }
    }

    try {
      let disableToolCalling = false;
      try {
        const { getSettings } = await import("@/lib/localDb.js");
        const settings = await getSettings();
        if (settings?.webCookieToolCalling?.["gemini-web"] === false) {
          disableToolCalling = true;
        }
      } catch {
        // fail-open
      }
      const built = buildPromptWithTools(messages, bodyObj, { disableToolCalling });
      prompt = built.prompt;
      toolMode = built.toolMode;
    } catch (err) {
      return {
        response: errorResponse(400, err instanceof Error ? err.message : "Invalid Gemini Web request"),
        url: GEMINI_URL,
        headers: {},
        transformedBody: body,
      };
    }
    const hasUser = messages.some(
      (m) => m.role === "user" && extractText(m.content).trim().length > 0
    );
    if (!prompt || !prompt.trim() || (!hasUser && messages.length === 0)) {
      return {
        response: errorResponse(400, "No user message found"),
        url: GEMINI_URL,
        headers: {},
        transformedBody: body,
      };
    }

    let session;
    try {
      session = await fetchSessionParams(cookie, false, proxyOptions);
    } catch (err) {
      return {
        response: errorResponse(502, `Gemini session fetch failed: ${describeFetchError(err)}`),
        url: GEMINI_URL,
        headers: {},
        transformedBody: body,
      };
    }
    if (!session) {
      return {
        response: errorResponse(401, "Gemini cookie expired or invalid, re-copy __Secure-1PSID from gemini.google.com cookies"),
        url: GEMINI_URL,
        headers: {},
        transformedBody: body,
      };
    }

    // Handle thinking parameter overrides from request body (OpenAI reasoning_effort, thinking object, or budget)
    let isThinking = !!modelCfg.thinking;
    if (bodyObj.thinking?.type === "disabled" || bodyObj.reasoning_effort === "none") {
      isThinking = false;
    } else if (
      bodyObj.thinking?.type === "enabled" ||
      (typeof bodyObj.reasoning_effort === "string" && bodyObj.reasoning_effort !== "none") ||
      (typeof bodyObj.thinking_budget === "number" && bodyObj.thinking_budget > 0) ||
      (typeof bodyObj.budget_tokens === "number" && bodyObj.budget_tokens > 0)
    ) {
      isThinking = true;
    }

    const reqUuid = uuid4();
    const thinkVal = isThinking ? THINKING_EXTENDED : THINKING_NORMAL;
    const innerJson = buildInnerPayload(prompt, {
      mode: modelCfg.mode ?? 1,
      thinking: isThinking,
      uuid: reqUuid,
    });
    const outerJson = JSON.stringify([null, innerJson]);

    const headers = browserHeaders(cookie);
    const modelHeader = buildModelHeader(modelCfg.hexID, modelCfg.mode ?? 1, thinkVal, reqUuid);
    if (modelHeader) headers["x-goog-ext-525001261-jspb"] = modelHeader;
    // A DIFFERENT uuid from inner[59] - the capture shows two distinct values.
    headers["x-goog-ext-525005358-jspb"] = `["${uuid4()}",1]`;

    const sapisid = cookieValue(cookie, "SAPISID");
    if (sapisid) {
      const ts = Math.floor(Date.now() / 1000);
      headers.Authorization = makeSapisidHash(ts, sapisid);
    }

    const reqId = Math.floor(Math.random() * 900000) + 100000;
    const params = new URLSearchParams({
      bl: session.bl,
      hl: "en",
      _reqid: String(reqId),
      rt: "c",
    });

    let upstream;
    try {
      const form = new URLSearchParams();
      form.set("f.req", outerJson);
      // The at (XSRF) field is REQUIRED whenever a cookie is present: without
      // it the server answers 400 immediately. It is bound to the cookie
      // session, so it has to be fetched per request rather than cached.
      if (session.at) form.set("at", session.at);
      upstream = await geminiFetch(`${STREAM_URL}?${params.toString()}`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: form.toString(),
        signal: signal ?? undefined,
      }, proxyOptions);
    } catch (err) {
      return {
        response: errorResponse(502, `Gemini fetch failed: ${describeFetchError(err)}`),
        url: GEMINI_URL,
        headers: {},
        transformedBody: body,
      };
    }

    // Retry once with a forced session refresh if rejected with 400/401/403 (e.g. stale XSRF token)
    if (!upstream.ok && (upstream.status === 400 || upstream.status === 401 || upstream.status === 403)) {
      log?.warn?.("GEMINI-WEB", `Upstream HTTP ${upstream.status}, attempting session refresh`);
      try {
        const freshSession = await fetchSessionParams(cookie, true, proxyOptions);
        if (freshSession?.at) {
          session = freshSession;
          const retryParams = new URLSearchParams({
            bl: session.bl,
            hl: "en",
            _reqid: String(Math.floor(Math.random() * 900000) + 100000),
            rt: "c",
          });
          const retryForm = new URLSearchParams();
          retryForm.set("f.req", outerJson);
          retryForm.set("at", session.at);
          upstream = await geminiFetch(`${STREAM_URL}?${retryParams.toString()}`, {
            method: "POST",
            headers: {
              ...headers,
              "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            },
            body: retryForm.toString(),
            signal: signal ?? undefined,
          }, proxyOptions);
        }
      } catch (retryErr) {
        log?.warn?.("GEMINI-WEB", `Session refresh retry failed: ${describeFetchError(retryErr)}`);
      }
    }

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      log?.error?.("GEMINI-WEB", `Upstream HTTP ${upstream.status}`);
      return {
        response: errorResponse(upstream.status, `Gemini error: ${errText.slice(0, 300)}`),
        url: GEMINI_URL,
        headers: {},
        transformedBody: body,
      };
    }

    const raw = await readGeminiStream(upstream, signal);
    const responseText = parseStreamResponse(raw);
    const reasoning = parseStreamReasoning(raw);
    if (!responseText) {
      // Upstream answered 200 but the body arrived empty or unreadable. Say so
      // plainly: the previous message blamed the cookie, which sent people
      // re-copying a perfectly good __Secure-1PSID.
      log?.error?.("GEMINI-WEB", `Empty upstream body (${raw.length} bytes) for ${modelId}`);
      return {
        response: errorResponse(
          502,
          `Gemini returned no content for ${modelId} (${raw.length} bytes received). The web endpoint is slow from here - retry, or use a model with a shorter queue.`
        ),
        url: GEMINI_URL,
        headers: {},
        transformedBody: body,
      };
    }

    const visible = cleanGeminiText(responseText) || responseText;

    // Recover a tool call from the model's own reply.
    const parsed = toolMode ? parseToolCallReply(visible) : { content: visible, calls: [] };
    const content = parsed.content || "";
    const calls = parsed.calls;

    // Calculate token usage based on request body and actual generated output
    const outputLen = (content ? content.length : 0) +
      (reasoning ? reasoning.length : 0) +
      (calls?.length ? JSON.stringify(calls).length : 0);
    const promptTokens = estimateInputTokens(body);
    const completionTokens = estimateOutputTokens(outputLen);
    const calculatedUsage = {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
      estimated: true,
    };

    if (stream) {
      const encoder = new TextEncoder();
      const id = `chatcmpl-gwe-${Date.now()}`;
      const created = Math.floor(Date.now() / 1000);
      const base = { id, object: "chat.completion.chunk", created, model: modelId };
      const readable = new ReadableStream({
        start(controller) {
          const push = (delta, finishReason, usage) =>
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  ...base,
                  choices: [{ index: 0, delta, ...(finishReason ? { finish_reason: finishReason } : {}) }],
                  ...(usage ? { usage } : {}),
                })}\n\n`
              )
            );
          if (reasoning) push({ reasoning_content: reasoning }, null);
          if (content) push({ content }, null);
          let sentCalls = false;
          if (calls.length) {
            sentCalls = emitToolCallChunks(
              (delta, finishReason) => push(delta, finishReason),
              () => push({ role: "assistant", content: "" }, null),
              calls
            );
          }
          if (!sentCalls) push({}, "stop", calculatedUsage);
          else push({}, null, calculatedUsage);
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return {
        response: new Response(readable, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        }),
        url: GEMINI_URL,
        headers: {},
        transformedBody: body,
        responseFormat: FORMATS.OPENAI,
      };
    }

    const message = { role: "assistant", content: content || null };
    if (reasoning) message.reasoning_content = reasoning;
    if (calls.length) {
      message.tool_calls = calls.map((call) => ({
        id: `call_${call.name}_${Date.now().toString(36)}`,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) },
      }));
    }
    return {
      response: new Response(
        JSON.stringify({
          id: `chatcmpl-${Date.now()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: modelId,
          choices: [
            {
              index: 0,
              message,
              finish_reason: calls.length ? "tool_calls" : "stop",
            },
          ],
          usage: calculatedUsage,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ),
      url: GEMINI_URL,
      headers: {},
      transformedBody: body,
      responseFormat: FORMATS.OPENAI,
    };
  }
}

/**
 * SAPISIDHASH. SAPISID expires roughly every 30 minutes; a Chrome-exported
 * cookie cannot be renewed because Chrome binds the session to the device,
 * which is why a Firefox-exported cookie is the one that keeps working.
 */
export function makeSapisidHash(timestampSeconds, sapisid) {
  const input = `${timestampSeconds} ${sapisid} https://gemini.google.com`;
  const digest = createHash("sha1").update(input, "utf8").digest("hex");
  return `SAPISIDHASH ${timestampSeconds}_${digest}`;
}