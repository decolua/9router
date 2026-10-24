// ChatGPT Web browser session (clean-room, direct-conversation path).
//
// A logged-in first-party page owns every challenge: ChatGPT's own module
// executes Sentinel, Turnstile, proof-of-work, cookies, and conduit
// preparation. Callers receive only the sanitized stream result. The 9router
// port keeps just the direct `/f/conversation` path used by the clean-room
// adapter (the shared-WebSocket handoff flow is not wired here).

import { ChatGptWebDeltaV1Decoder, parseChatGptWebEncodedItem } from "./deltaV1.js";
import { executeChatGptWebFirstPartyTurn } from "./firstParty.js";

const CHATGPT_WEB_ORIGIN = "https://chatgpt.com";
const DEFAULT_TURN_TIMEOUT_MS = 180000;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requirePrompt(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("ChatGPT Web browser turn requires a non-empty prompt");
  }
  return value;
}

function requireFirstPartyUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("ChatGPT Web browser session requires a valid URL");
  }
  if (url.origin !== CHATGPT_WEB_ORIGIN) {
    throw new Error("ChatGPT Web browser session requires the first-party chatgpt.com origin");
  }
}

function maybeTerminalResult(snapshot, conversationId, turnExchangeId) {
  if (!isRecord(snapshot) || !isRecord(snapshot.message)) return null;
  const message = snapshot.message;
  const author = isRecord(message.author) ? message.author : null;
  const content = isRecord(message.content) ? message.content : null;
  const parts = Array.isArray(content?.parts) ? content.parts : [];
  if (
    author?.role !== "assistant" ||
    content?.content_type !== "text" ||
    !parts.every((part) => typeof part === "string") ||
    message.status !== "finished_successfully" ||
    message.end_turn !== true
  ) {
    return null;
  }
  return {
    conversationId,
    turnExchangeId,
    text: parts.join(""),
    status: message.status,
    endTurn: true,
  };
}

function terminalResult(snapshot, conversationId, turnExchangeId) {
  const result = maybeTerminalResult(snapshot, conversationId, turnExchangeId);
  if (result) return result;
  if (!isRecord(snapshot) || !isRecord(snapshot.message)) {
    const rootKeys = isRecord(snapshot) ? Object.keys(snapshot).sort().join(",") : "non-object";
    throw new Error(`ChatGPT Web assistant document is incomplete (root=${rootKeys})`);
  }
  const message = snapshot.message;
  const author = isRecord(message.author) ? message.author : null;
  const content = isRecord(message.content) ? message.content : null;
  const parts = Array.isArray(content?.parts) ? content.parts : [];
  const summary = JSON.stringify({
    messageKeys: Object.keys(message).sort(),
    role: author?.role ?? null,
    contentType: content?.content_type ?? null,
    partCount: parts.length,
    partTypes: parts.map((part) => typeof part),
    status: message.status ?? null,
    endTurn: message.end_turn ?? null,
  });
  throw new Error(`ChatGPT Web assistant document is incomplete (${summary})`);
}

function encodeParsedEvent(event) {
  const eventLine = event.event === "message" ? "" : `event: ${event.event}\n`;
  return `${eventLine}data: ${event.data}\n\n`;
}

/** Decode the direct first-party `/f/conversation` SSE body. */
export function parseChatGptWebDirectConversation(sseText) {
  if (typeof sseText !== "string" || !sseText.trim()) {
    throw new Error("ChatGPT Web direct conversation returned an empty stream");
  }
  let decoder = new ChatGptWebDeltaV1Decoder();
  let conversationId = "";
  let turnExchangeId = "";
  let latestTerminal = null;
  for (const event of parseChatGptWebEncodedItem(sseText)) {
    if (isRecord(event.json)) {
      if (typeof event.json.conversation_id === "string") {
        conversationId = event.json.conversation_id;
      }
      if (typeof event.json.turn_exchange_id === "string") {
        turnExchangeId = event.json.turn_exchange_id;
      }
    }
    if (event.event === "delta_encoding") {
      latestTerminal =
        maybeTerminalResult(decoder.snapshot(), conversationId, turnExchangeId) ?? latestTerminal;
      decoder = new ChatGptWebDeltaV1Decoder();
    }
    decoder.ingest(encodeParsedEvent(event));
    latestTerminal =
      maybeTerminalResult(decoder.snapshot(), conversationId, turnExchangeId) ?? latestTerminal;
  }
  const result =
    maybeTerminalResult(decoder.snapshot(), conversationId, turnExchangeId) ?? latestTerminal;
  if (!result) return terminalResult(decoder.snapshot(), conversationId, turnExchangeId);
  return { ...result, conversationId, turnExchangeId };
}

/**
 * Playwright binding for a logged-in ChatGPT page. ChatGPT's own loaded module
 * performs auth and Sentinel inside the page; the hot path never touches the
 * composer, model picker, attachment input, cookies, or bearer tokens.
 */
export class PlaywrightChatGptWebBrowserSession {
  constructor(page, options = {}) {
    this.page = page;
    this.pageUrl = options.pageUrl ?? "https://chatgpt.com/?temporary-chat=true";
    this.selection = options.selection;
    this.closePageOnCleanup = options.closePageOnCleanup === true;
    this.executePageRequest = options.executePageRequest ?? executeChatGptWebFirstPartyTurn;
  }

  url() {
    return this.pageUrl;
  }

  async start() {
    requireFirstPartyUrl(this.pageUrl);
    const cleanup = async () => {
      if (this.closePageOnCleanup) await this.page.close().catch(() => {});
    };
    try {
      let currentIsFirstParty = false;
      try {
        currentIsFirstParty = new URL(this.page.url()).origin === CHATGPT_WEB_ORIGIN;
      } catch {
        currentIsFirstParty = false;
      }
      if (!currentIsFirstParty) {
        await this.page.goto(this.pageUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      }
      requireFirstPartyUrl(this.page.url());
      return cleanup;
    } catch (error) {
      await cleanup();
      throw error;
    }
  }

  async submitPrompt(request) {
    if (!this.selection) throw new Error("ChatGPT Web direct request requires a model selection");
    requireFirstPartyUrl(this.page.url());
    return this.executePageRequest(
      this.page,
      {
        prompt: requirePrompt(request.prompt),
        attachments: request.attachments,
        selection: this.selection,
        pluginHints: request.pluginHints ?? [],
      },
      { signal: request.signal }
    );
  }
}

/** Run one turn while the first-party browser remains the sole challenge and auth owner. */
export async function runChatGptWebBrowserTurn(session, request) {
  if (request.signal?.aborted) throw new Error("ChatGPT Web browser turn aborted");
  const prompt = requirePrompt(request.prompt);
  requireFirstPartyUrl(session.url());
  const timeoutMs = request.timeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("ChatGPT Web browser turn requires a positive timeout");
  }

  let cleanup = null;
  let timer;
  const timedOut = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("ChatGPT Web browser turn timed out")), timeoutMs);
    timer.unref?.();
  });
  try {
    const turn = (async () => {
      cleanup = await session.start();
      const directResponse = await session.submitPrompt({
        prompt,
        attachments: request.attachments ?? [],
        pluginHints: request.pluginHints ?? [],
        signal: request.signal,
      });
      return parseChatGptWebDirectConversation(directResponse);
    })();
    void turn.catch(() => {});
    return await Promise.race([turn, timedOut]);
  } finally {
    clearTimeout(timer);
    await cleanup?.();
  }
}
