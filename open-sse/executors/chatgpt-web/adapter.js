// ChatGPT Web clean-room executor adapter.
//
// Validates the storage state (cookies + localStorage), flattens the prompt,
// resolves the UI model selection, and drives one browser turn through the
// pooled headless context (Sentinel/PoW is solved in-page, so no real window
// is needed).

import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { acquireBrowserContext, openPage } from "../../services/browserPool.js";
import {
  extractChatGptWebAttachmentSources,
  isChatGptWebAttachmentContentPart,
  resolveChatGptWebAttachments,
} from "./attachments.js";
import { PlaywrightChatGptWebBrowserSession, runChatGptWebBrowserTurn } from "./browserSession.js";
import { prepareToolMessages } from "../../translator/webTools.js";
import { buildToolModeResponse } from "../chatgptWebTools.js";

const CHATGPT_WEB_PAGE_URL = "https://chatgpt.com/?temporary-chat=true";
const MAX_PROMPT_BYTES = 4 * 1024 * 1024;
const FIRST_PARTY_COOKIE_HOSTS = ["chatgpt.com", "openai.com"];

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFirstPartyHost(value) {
  const host = value.toLowerCase().replace(/^\./, "");
  return FIRST_PARTY_COOKIE_HOSTS.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`)
  );
}

function validateCookie(value) {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    !value.name ||
    typeof value.value !== "string" ||
    typeof value.domain !== "string" ||
    typeof value.path !== "string" ||
    !value.path.startsWith("/") ||
    typeof value.expires !== "number" ||
    !Number.isFinite(value.expires) ||
    typeof value.httpOnly !== "boolean" ||
    typeof value.secure !== "boolean" ||
    !["Strict", "Lax", "None"].includes(String(value.sameSite))
  ) {
    throw new Error("ChatGPT Web browser storage state contains an invalid cookie");
  }
  if (!isFirstPartyHost(value.domain)) {
    throw new Error("ChatGPT Web browser storage state contains a foreign cookie domain");
  }
}

function validateOrigin(value) {
  if (!isRecord(value) || typeof value.origin !== "string" || !Array.isArray(value.localStorage)) {
    throw new Error("ChatGPT Web browser storage state contains an invalid origin");
  }
  let url;
  try {
    url = new URL(value.origin);
  } catch {
    throw new Error("ChatGPT Web browser storage state contains an invalid origin");
  }
  if (url.protocol !== "https:" || !isFirstPartyHost(url.hostname)) {
    throw new Error("ChatGPT Web browser storage state contains a foreign origin");
  }
  for (const entry of value.localStorage) {
    if (!isRecord(entry) || typeof entry.name !== "string" || typeof entry.value !== "string") {
      throw new Error("ChatGPT Web browser storage state contains invalid local storage");
    }
  }
}

export function normalizeChatGptWebStorageState(value) {
  if (!isRecord(value) || !Array.isArray(value.cookies) || !Array.isArray(value.origins)) {
    throw new Error("ChatGPT Web browser storage state is invalid");
  }
  for (const cookie of value.cookies) validateCookie(cookie);
  for (const origin of value.origins) validateOrigin(origin);
  const state = structuredClone(value);
  // `__Host-` cookies must be host-only: no Domain attribute, Path=/, Secure.
  // Browsers reject them when injected with a leading-dot domain.
  for (const cookie of state.cookies) {
    if (!cookie.name.startsWith("__Host-")) continue;
    cookie.domain = cookie.domain.replace(/^\./, "");
    cookie.path = "/";
    cookie.secure = true;
  }
  return state;
}

export function chatGptWebStorageStateFromCookieHeader(raw) {
  const header = raw.trim().replace(/^Cookie:\s*/i, "");
  if (!header) throw new Error("ChatGPT Web Cookie header is empty");

  // Bare session-token value (JWE payload — no `name=` prefix at all).
  if (!header.includes("=")) {
    return normalizeChatGptWebStorageState({
      cookies: [
        {
          name: "__Secure-next-auth.session-token",
          value: header,
          domain: ".chatgpt.com",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        },
      ],
      origins: [],
    });
  }

  const parts = header.split(/;\s*/);
  const cookies = parts.map((part) => {
    const separator = part.indexOf("=");
    if (separator <= 0) throw new Error("ChatGPT Web Cookie header contains an invalid cookie");
    return [part.slice(0, separator).trim(), part.slice(separator + 1)];
  });

  if (!cookies.some(([name]) => /^__Secure-next-auth\.session-token(?:\.\d+)?$/.test(name))) {
    if (header.includes(";") || header.includes("=")) {
      throw new Error("ChatGPT Web Cookie header is missing __Secure-next-auth.session-token");
    }
    cookies.splice(0, cookies.length, ["__Secure-next-auth.session-token", header]);
  }

  return normalizeChatGptWebStorageState({
    cookies: cookies.map(([name, value]) => ({
      name,
      value,
      domain: ".chatgpt.com",
      path: "/",
      expires: -1,
      httpOnly: name.startsWith("__Secure-") || name.startsWith("__Host-"),
      secure: true,
      sameSite: "Lax",
    })),
    origins: [],
  });
}

function contentText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) {
    throw new Error("ChatGPT Web clean-room adapter supports text content only");
  }
  const parts = [];
  for (const part of value) {
    if (
      isRecord(part) &&
      (part.type === "text" || part.type === "input_text") &&
      typeof part.text === "string"
    ) {
      parts.push(part.text);
      continue;
    }
    if (isChatGptWebAttachmentContentPart(part)) continue;
    throw new Error("ChatGPT Web clean-room adapter received unsupported content");
  }
  return parts.join("");
}

/**
 * Flatten OpenAI messages into prompt lines, rendering prior tool calls and
 * tool results as the `<tool>` text contract the prompt-side shim teaches.
 * chatgpt.com has no native function calling, so the whole agent loop is
 * replayed as text.
 */
function flattenMessages(messages) {
  const callNameById = new Map();
  const systemLines = [];
  const lines = [];
  let sawToolActivity = false;

  for (const value of messages) {
    if (!isRecord(value) || typeof value.role !== "string") {
      throw new Error("ChatGPT Web clean-room adapter received an invalid message");
    }
    const text = contentText(value.content).trim();

    if (value.role === "system" || value.role === "developer") {
      if (text) systemLines.push(text);
      continue;
    }
    if (value.role === "user") {
      if (text) lines.push(`User:\n${text}`);
      continue;
    }
    if (value.role === "assistant") {
      const parts = [];
      if (text) parts.push(text);
      for (const call of Array.isArray(value.tool_calls) ? value.tool_calls : []) {
        const name = typeof call?.function?.name === "string" ? call.function.name : "";
        const rawArgs = call?.function?.arguments;
        const args = typeof rawArgs === "string" && rawArgs ? rawArgs : JSON.stringify(rawArgs ?? {});
        if (call?.id) callNameById.set(call.id, name);
        parts.push(`<tool>{"name": ${JSON.stringify(name)}, "arguments": ${args}}</tool>`);
        sawToolActivity = true;
      }
      if (parts.length) lines.push(`Assistant:\n${parts.join("\n")}`);
      continue;
    }
    if (value.role === "tool") {
      const name = (value.tool_call_id && callNameById.get(value.tool_call_id)) || value.name || "tool";
      lines.push(`Tool result (${name}): ${text || "(no output)"}`);
      sawToolActivity = true;
      continue;
    }
    throw new Error(`ChatGPT Web clean-room adapter does not support the "${value.role}" role`);
  }

  if (sawToolActivity) {
    lines.push(
      "Continue the task using the tool results above. Do NOT repeat tool calls that already " +
        "succeeded; perform the next step or give the final answer."
    );
  }
  return [...systemLines, ...lines];
}

function buildPrompt(body) {
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new Error("ChatGPT Web clean-room adapter requires messages");
  }
  // Single plain user turn (no tools, no system prompt) goes through verbatim so
  // ordinary chat keeps its exact wording.
  const only = body.messages[0];
  const isPlainTurn =
    body.messages.length === 1 &&
    isRecord(only) &&
    only.role === "user" &&
    !(Array.isArray(body.tools) && body.tools.length > 0);

  let prompt;
  let hasTools = false;
  let requestedTools;
  if (isPlainTurn) {
    prompt = contentText(only.content);
  } else {
    // Tools ride the shared prompt-side shim: it appends the `<tool>` contract
    // plus a reminder inside the latest user turn.
    const effective = prepareToolMessages(body, body.messages);
    hasTools = effective.hasTools;
    requestedTools = effective.requestedTools;
    prompt = flattenMessages(effective.effectiveMessages).join("\n\n");
  }

  if (!prompt.trim()) throw new Error("ChatGPT Web clean-room adapter requires non-empty text");
  if (new TextEncoder().encode(prompt).byteLength > MAX_PROMPT_BYTES) {
    throw new Error("ChatGPT Web clean-room adapter prompt is too large");
  }
  return { prompt, hasTools, requestedTools };
}

function reasoningEffort(body) {
  if (typeof body.reasoning_effort === "string") return body.reasoning_effort.toLowerCase();
  if (isRecord(body.reasoning) && typeof body.reasoning.effort === "string") {
    return body.reasoning.effort.toLowerCase();
  }
  return null;
}

function effortIndex(effort) {
  if (effort === null || effort === "medium") return 1;
  if (["none", "off", "minimal", "low"].includes(effort)) return 0;
  if (effort === "high") return 2;
  if (effort === "xhigh" || effort === "max") return 3;
  throw new Error(`ChatGPT Web clean-room adapter does not support reasoning effort ${effort}`);
}

function normalizedModel(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^chatgpt-web\//, "")
    .replace(/^cgpt-web\//, "")
    .replace(/\./g, "-");
}

function resolveSelection(model, body) {
  const normalized = normalizedModel(model);
  if (normalized === "gpt-5-6-luna-free") {
    return { kind: "free", thinkEnabled: false };
  }
  if (normalized === "gpt-5-6-luna-free-thinking") {
    return { kind: "free", thinkEnabled: true };
  }
  if (normalized === "gpt-5-6-pro") {
    return { kind: "picker", modelLabel: "GPT-5.6 Sol", effortIndex: 4 };
  }
  if (normalized === "gpt-5-6-instant" || normalized === "gpt-5-6") {
    return { kind: "picker", modelLabel: "GPT-5.6 Sol", effortIndex: 0 };
  }
  if (["gpt-5-6-thinking", "gpt-5-6-sol"].includes(normalized)) {
    return {
      kind: "picker",
      modelLabel: "GPT-5.6 Sol",
      effortIndex: effortIndex(reasoningEffort(body)),
    };
  }
  if (normalized === "gpt-5-5-pro") {
    return { kind: "picker", modelLabel: "GPT-5.5", effortIndex: 4 };
  }
  if (normalized === "gpt-5-5-instant") {
    return { kind: "picker", modelLabel: "GPT-5.5", effortIndex: 0 };
  }
  if (["gpt-5-5", "gpt-5-5-thinking"].includes(normalized)) {
    return {
      kind: "picker",
      modelLabel: "GPT-5.5",
      effortIndex: effortIndex(reasoningEffort(body)),
    };
  }
  throw new Error(`ChatGPT Web clean-room adapter received an unsupported model: ${model}`);
}

export function prepareChatGptWebBrowserRequest(model, body) {
  if (!isRecord(body)) throw new Error("ChatGPT Web clean-room adapter requires an object body");
  const { prompt, hasTools, requestedTools } = buildPrompt(body);
  const attachments = extractChatGptWebAttachmentSources(
    body.messages
  );
  return { prompt, selection: resolveSelection(model, body), attachments, hasTools, requestedTools };
}

/**
 * Normalize the connection's MCP connector hints ("plugin:<app_id>"). Accepts
 * an array or a comma/newline-separated string; invalid entries are dropped.
 */
export function resolveChatGptWebPluginHints(value) {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,\n]/)
      : [];
  const seen = new Set();
  const hints = [];
  for (const raw of list) {
    const hint = typeof raw === "string" ? raw.trim() : "";
    if (!/^plugin:[A-Za-z0-9_-]+$/.test(hint) || seen.has(hint)) continue;
    seen.add(hint);
    hints.push(hint);
  }
  return hints;
}

export function readStorageState(credentials) {
  const providerData = credentials.providerSpecificData;
  const raw = providerData?.storageState ?? credentials.apiKey;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    // Full Playwright storage-state JSON
    if (trimmed.startsWith("{")) {
      try {
        return normalizeChatGptWebStorageState(JSON.parse(trimmed));
      } catch {
        throw new Error("ChatGPT Web browser storage state JSON is invalid");
      }
    }
    // Cookie header ("__Secure-next-auth.session-token=…; …") or a bare
    // session-token value — the single cookie input of the dashboard.
    return chatGptWebStorageStateFromCookieHeader(trimmed);
  }
  return normalizeChatGptWebStorageState(raw);
}

function optionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function resolveChatGptWebChromeExecutable(explicit) {
  const env = process.env;
  const candidates = [
    explicit,
    env.CHATGPT_WEB_CHROME_PATH,
    env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    ...(env.PROGRAMFILES
      ? [join(env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe")]
      : []),
    ...(env["PROGRAMFILES(X86)"]
      ? [join(env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe")]
      : []),
    ...(env.LOCALAPPDATA
      ? [join(env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")]
      : []),
  ];
  return candidates.find((candidate) => Boolean(candidate?.trim() && existsSync(candidate.trim())));
}

export async function createDefaultSession(input) {
  const digest = createHash("sha256")
    .update(input.connectionId)
    .update("\0")
    .update(JSON.stringify(input.storageState))
    .digest("hex");
  const pooled = await acquireBrowserContext(`chatgpt-web-cleanroom:${digest}`, {
    cookieDomain: "chatgpt.com",
    storageState: input.storageState,
    userAgent: input.userAgent,
    locale: input.locale,
    timezone: input.timezone,
    warmupUrl: CHATGPT_WEB_PAGE_URL,
    // Headless works for the picture_v2 pipeline (verified live); a headed
    // window buys nothing and needs an X server on Linux hosts.
    headless: true,
    executablePath: input.chromeExecutablePath,
  });
  const page =
    pooled.warmupPage && !pooled.warmupPage.isClosed() ? pooled.warmupPage : await openPage(pooled);
  if (pooled.warmupPage !== page) pooled.warmupPage = page;
  return new PlaywrightChatGptWebBrowserSession(page, {
    pageUrl: CHATGPT_WEB_PAGE_URL,
    selection: input.selection,
    closePageOnCleanup: false,
  });
}

export function buildChatGptWebOpenAiResponse(model, result, stream, metadata = {}) {
  const id = metadata.id ?? `chatcmpl-${randomUUID()}`;
  const created = metadata.created ?? Math.floor(Date.now() / 1000);
  if (!stream) {
    return Response.json({
      id,
      object: "chat.completion",
      created,
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: result.text },
          finish_reason: "stop",
        },
      ],
    });
  }

  const chunks = [
    {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    },
    {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: { content: result.text }, finish_reason: null }],
    },
    {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    },
  ];
  return new Response(
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n",
    { headers: { "Content-Type": "text/event-stream; charset=utf-8" } }
  );
}

export async function executeChatGptWebCleanRoom(input) {
  const prepared = prepareChatGptWebBrowserRequest(input.model, input.body);
  const attachments = await resolveChatGptWebAttachments(prepared.attachments);
  const storageState = readStorageState(input.credentials);
  const connectionId = optionalString(input.credentials.connectionId);
  if (!connectionId) throw new Error("ChatGPT Web clean-room adapter requires a connection ID");
  const providerData = input.credentials.providerSpecificData;
  const session = await createDefaultSession({
    connectionId,
    storageState,
    selection: prepared.selection,
    userAgent: optionalString(providerData?.customUserAgent),
    locale: optionalString(providerData?.locale),
    timezone: optionalString(providerData?.timezone),
    chromeExecutablePath: resolveChatGptWebChromeExecutable(
      optionalString(providerData?.chromeExecutablePath)
    ),
  });
  const result = await runChatGptWebBrowserTurn(session, {
    prompt: prepared.prompt,
    attachments,
    pluginHints: resolveChatGptWebPluginHints(providerData?.pluginHints),
    signal: input.signal,
  });
  if (!prepared.hasTools) {
    return buildChatGptWebOpenAiResponse(input.model, result, input.stream);
  }
  // Tool mode: parse the `<tool>` blocks the model wrote back into OpenAI
  // tool_calls, then replay the completion as JSON or a terminal SSE chunk.
  const buffered = buildChatGptWebOpenAiResponse(input.model, result, false);
  return buildToolModeResponse(buffered, prepared.requestedTools, input.stream, {
    idSeed: "cgpt",
    cid: `chatcmpl-${randomUUID()}`,
    created: Math.floor(Date.now() / 1000),
    model: input.model,
  });
}
