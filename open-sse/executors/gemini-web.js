// GeminiWebExecutor — Gemini Web Session Provider
//
// Routes requests through Google Gemini's web interface using browser
// cookies + Playwright automation. Translates between OpenAI chat
// completions format and Gemini's web UI.
//
// Auth: Cookie-based (__Secure-1PSID + __Secure-1PSIDTS from gemini.google.com)
// Method: Playwright browser automation
//
// Note: Streaming is pseudo-streaming — waits for full Gemini response then
// sends as single SSE chunk. Gemini's StreamGenerate endpoint returns complete
// responses, not chunked streams.

import { BaseExecutor } from "./base.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { isMissingBrowserExecutable, resolveSystemChromeExecutable, launchChromiumWithFallback } from "./browserExecutableCheck.js";
import { loadRuntimeDep } from "../services/lazyRuntime.js";
import { normalizeGeminiCookieInput } from "../utils/geminiCookies.js";
import { toPlaywrightCookies } from "../utils/webCookieAuth.js";
import { prepareToolMessages } from "../translator/webTools.js";
import { buildToolModeResponse } from "./chatgptWebTools.js";
import {
  checkGeminiWebUnsupportedControls,
  GEMINI_WEB_UNSUPPORTED_CONTROL_CODE,
  isForcingToolChoice,
  requestsThinkingBudget,
} from "./gemini-web/capabilities.js";
import {
  describeModeSelectionFailure,
  selectGeminiExtendedThinking,
  selectGeminiModel,
} from "./gemini-web/modeSelection.js";
import { readReplyState, waitForGeminiReply } from "./gemini-web/domCapture.js";
import { buildImagePrompt, waitForGeminiImage } from "./gemini-web/imageGen.js";

// ─── Constants ──────────────────────────────────────────────────────────────

const GEMINI_URL = "https://gemini.google.com/app";
/** Response-label fallback when no `model` was requested at all. */
const DEFAULT_MODEL_ID = "gemini-2.5-pro";

export { isMissingBrowserExecutable } from "./browserExecutableCheck.js";

const GEMINI_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

// ─── Helpers ────────────────────────────────────────────────────────────────

// Module-level (not a per-request closure) so browserLease's
// `slot.launch === launch` check reuses the process instead of relaunching.
async function launchGeminiChromium(options) {
  const { chromium } = await loadRuntimeDep("playwright-core");
  const executablePath = resolveSystemChromeExecutable();
  return launchChromiumWithFallback(chromium, { ...options, ...(executablePath ? { executablePath } : {}) });
}

function formatChatCompletion(content, model, finishReason = "stop") {
  return {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: finishReason, logprobs: null }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

function formatStreamChunk(content, model, finishReason = null) {
  return {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta: content ? { content } : {}, finish_reason: finishReason }],
  };
}

/**
 * Flatten the OpenAI-style multi-turn `messages[]` into the single plain-text
 * prompt typed into the Gemini web UI.
 *
 * gemini-web drives a real browser page and captures only the FIRST
 * `StreamGenerate` response, so it has no upstream conversation id to thread
 * across turns. It is therefore a stateless, single-turn provider: flattening
 * the full history into one prompt is the accepted fallback so the web UI
 * still sees the conversation.
 *
 * Single-turn requests with NO system message are preserved byte-for-byte
 * (only the final user message is returned). A single-turn request that DOES
 * carry a system message prepends it the same way the multi-turn branch does.
 * Multi-turn requests emit a labeled transcript:
 *
 *   System:
 *   <system text>
 *
 *   Previous conversation:
 *   User: ...
 *   Assistant: ...
 *
 *   Current user message:
 *   <last user message>
 */
export function buildGeminiPrompt(messages) {
  const textMessages = messages.filter(
    (m) => typeof m.content === "string" && m.content.trim().length > 0
  );

  const userMessages = textMessages.filter((m) => m.role === "user");
  const lastUser = userMessages[userMessages.length - 1];
  const lastUserContent = lastUser?.content ?? "";
  const lastUserIdx = lastUser ? textMessages.lastIndexOf(lastUser) : -1;

  // Prior conversation = every user/assistant turn before the final user turn.
  const priorTurns = textMessages.filter(
    (m, i) => i < lastUserIdx && (m.role === "user" || m.role === "assistant")
  );

  const systemText = textMessages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");

  // Single-turn (no earlier user/assistant turns) with no system message:
  // byte-for-byte the original single-message derivation.
  if (priorTurns.length === 0 && !systemText) return lastUserContent;

  // Single-turn with a system message: prepend it instead of dropping it.
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
 * Build the plain-text prompt typed into the Gemini web UI when a tool
 * contract is active — every system message (the client's own instruction(s)
 * plus the synthetic tool contract that `prepareToolMessages()` appends last)
 * prepended, in order, to the last user message. gemini-web only ever sends
 * a single flat string (no native message array), so the tool contract and
 * the user's ask are concatenated.
 *
 * Everything except the current ask has to be rendered: an assistant turn that
 * called a tool and the `role: "tool"` result for it are the only evidence
 * Gemini Web gets that the tool already ran. Dropping them made the model
 * re-issue the same call with a fresh id, looping until the client's tool
 * limit stopped it.
 *
 * The boundary must be the current ask itself, not "everything before it": a
 * tool round usually arrives as `system, user, assistant(tool_calls), tool`
 * with NO message after the result, so slicing at `lastUserIdx` threw away the
 * very turns the fix was for.
 */
export function buildGeminiToolPrompt(effectiveMessages) {
  const toolPrompt = effectiveMessages
    .filter((m) => m.role === "system" && typeof m.content === "string")
    .map((m) => m.content)
    .join("\n\n");
  const lastUserIdx = effectiveMessages.map((m) => m.role).lastIndexOf("user");
  const lastUserMsg = lastUserIdx >= 0 ? effectiveMessages[lastUserIdx] : undefined;
  const userText = typeof lastUserMsg?.content === "string" ? lastUserMsg.content : "";

  const prior = [];
  for (const [index, m] of effectiveMessages.entries()) {
    if (index === lastUserIdx) continue; // rendered below as the current ask
    if (typeof m.content === "string" && m.content.trim()) {
      if (m.role === "user") prior.push(`User: ${m.content}`);
      else if (m.role === "assistant") prior.push(`Assistant: ${m.content}`);
      else if (m.role === "tool") {
        const id = typeof m.tool_call_id === "string" ? m.tool_call_id : "";
        prior.push(id ? `Tool result [${id}]: ${m.content}` : `Tool result: ${m.content}`);
      }
    }
    const calls = Array.isArray(m.tool_calls) ? m.tool_calls : [];
    for (const call of calls) {
      const name = typeof call.function?.name === "string" ? call.function.name : "tool";
      const args = typeof call.function?.arguments === "string" ? call.function.arguments : "{}";
      const id = typeof call.id === "string" ? ` [${call.id}]` : "";
      prior.push(`Assistant requested tool${id}: ${name}(${args})`);
    }
  }

  // Single-turn: system contract + the current ask.
  if (prior.length === 0) return toolPrompt ? `${toolPrompt}\n\n${userText}` : userText;

  const parts = [];
  if (toolPrompt) parts.push(toolPrompt);
  parts.push(`Previous conversation:\n${prior.join("\n\n")}`);
  parts.push(`Current user message:\n${userText}`);
  return parts.join("\n\n");
}

/**
 * Tool mode: wrap the buffered Gemini response text in the standard OpenAI
 * completion shape, then delegate to the shared `buildToolModeResponse()` —
 * parses `<tool>{...}</tool>` blocks out of the text into `tool_calls`
 * (malformed JSON degrades to ordinary `content`, never throws) and replays
 * either buffered JSON or a terminal SSE chunk depending on `stream`.
 */
export async function buildGeminiToolResponse(responseText, requestedTools, stream, model, cid, created) {
  const bufferedJson = new Response(JSON.stringify(formatChatCompletion(responseText, model)), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
  return buildToolModeResponse(bufferedJson, requestedTools, stream, {
    cid,
    created,
    model,
    idSeed: "gwe",
  });
}

const GEMINI_APP_ERROR_TEXT =
  /something went wrong|try again later|unusual traffic|verify you are human/i;
const GEMINI_QUOTA_TEXT =
  /used all of your requests|quota will reset|quota exceeded|reached your limit/i;

/**
 * Watch the app's batchexecute RPCs for a quota rejection.
 *
 * When an account is out of requests Gemini does not render the composer — it
 * replies inside a background XHR and bounces the page to the marketing root,
 * which is indistinguishable from a dead session by page content alone.
 *
 * @returns {() => string|null} read the captured quota message, if any
 */
function watchGeminiQuota(page) {
  let quota = null;
  const onResponse = (res) => {
    if (quota || !/\/BardChatUi\/data\/batchexecute/.test(res.url())) return;
    void res
      .text()
      .then((text) => {
        if (!GEMINI_QUOTA_TEXT.test(text)) return;
        quota = "Gemini says this account is out of quota: \"You've used all of your requests for this feature\" — wait for the reset, or add another account";
      })
      .catch(() => {});
  };
  page.on("response", onResponse);
  return () => quota;
}

/**
 * Detect a Gemini app page that loaded but cannot serve a conversation.
 *
 * gemini.google.com/app bounces back to the marketing root when it refuses the
 * session (expired Google cookie, Gemini Apps Activity off, flagged account),
 * and the "Chat with Gemini" button then surfaces a generic error card. Both
 * cases otherwise only show up as an opaque `waitForSelector` timeout, so name
 * the real cause instead.
 *
 * @returns {Promise<null | string>} null when the composer is usable, else a message
 */
async function geminiAppBlocker(page, readQuota = () => null) {
  const composer = await page.locator(".ql-editor, [contenteditable='true']").count();
  if (composer > 0) return null;
  const quota = readQuota();
  if (quota) return quota;
  const text = await page.evaluate(() => document.body?.innerText?.slice(0, 2000) ?? "").catch(() => "");
  if (GEMINI_APP_ERROR_TEXT.test(text)) {
    return "Gemini refused the request (\"Something went wrong\") — the Google account cannot open Gemini. Sign in again, or enable Gemini Apps Activity for the account";
  }
  // Session refused: /app lands on the marketing splash (no route match, or a
  // visible "Chat with Gemini" CTA when the bounce kept the /app URL). The
  // quota RPC lands ~1s after the bounce, so give it a moment before blaming
  // the session — otherwise an out-of-quota account reads as "sign in again".
  const url = page.url();
  const marketing = /chat with gemini/i.test(text) || !/\/app(\/|$|\?)/.test(url);
  if (marketing) {
    for (let i = 0; i < 12; i++) {
      const late = readQuota();
      if (late) return late;
      await page.waitForTimeout(400);
    }
    return "Gemini did not open a chat session — open dashboard/providers/gemini-web, click Login via Browser and sign in to Google again (the account may also need Gemini Apps Activity enabled)";
  }
  return null;
}

/**
 * Open the Gemini app with the quota watcher already attached — the rejection
 * RPC fires during the initial load, so attaching after `goto` misses it.
 *
 * @returns {Promise<() => string|null>} quota reader for waitForGeminiComposer
 */
async function openGeminiApp(page) {
  const readQuota = watchGeminiQuota(page);
  await page.goto(GEMINI_URL, { waitUntil: "domcontentloaded", timeout: 20000 });
  return readQuota;
}

/**
 * Wait for the composer, polling so a refused session is reported by cause
 * instead of as a bare selector timeout.
 */
async function waitForGeminiComposer(page, readQuota = () => null, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const composer = await page.locator(".ql-editor, [contenteditable='true']").count();
    if (composer > 0) {
      return page.waitForSelector(".ql-editor, [contenteditable='true']", { timeout: 5000 });
    }
    const blocker = await geminiAppBlocker(page, readQuota);
    if (blocker) throw new Error(blocker);
    await page.waitForTimeout(400);
  }
  const quota = readQuota();
  if (quota) throw new Error(quota);
  const url = page.url();
  throw new Error(`Gemini composer did not appear within ${Math.round(timeout / 1000)}s (final URL: ${url})`);
}

/**
 * Parse cookie string, stripping attributes (Path, Domain, Expires, etc.)
 * Input: full browser cookie string or just "name=value; name2=value2"
 * Output: array of { name, value } pairs
 */
function parseCookies(raw) {
  return raw
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const eqIdx = part.indexOf("=");
      if (eqIdx === -1) return null;
      const name = part.substring(0, eqIdx).trim();
      const value = part.substring(eqIdx + 1).trim();
      // Skip cookie attributes that aren't name=value pairs
      if (!name || !value) return null;
      const lowerName = name.toLowerCase();
      if (
        ["path", "domain", "expires", "max-age", "secure", "httponly", "samesite"].includes(
          lowerName
        )
      ) {
        return null;
      }
      return { name, value };
    })
    .filter(Boolean);
}

function readCredentialString(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "";
}

function readProviderSpecificString(providerSpecificData, keys) {
  if (
    !providerSpecificData ||
    typeof providerSpecificData !== "object" ||
    Array.isArray(providerSpecificData)
  ) {
    return "";
  }
  for (const key of keys) {
    const value = readCredentialString(providerSpecificData[key]);
    if (value) return value;
  }
  return "";
}

function resolveGeminiWebCookie(credentials) {
  const directCookie =
    readCredentialString(credentials?.apiKey) ||
    readCredentialString(credentials?.cookie);
  if (directCookie) return normalizeGeminiCookieInput(directCookie);

  const providerSpecificData = credentials?.providerSpecificData;
  const cookie = readProviderSpecificString(providerSpecificData, ["cookie"]);
  if (cookie) return normalizeGeminiCookieInput(cookie);

  const psid = readProviderSpecificString(providerSpecificData, ["__Secure-1PSID"]);
  const psidts = readProviderSpecificString(providerSpecificData, ["__Secure-1PSIDTS"]);
  return [
    psid ? normalizeGeminiCookieInput(psid, "__Secure-1PSID") : "",
    psidts ? normalizeGeminiCookieInput(psidts, "__Secure-1PSIDTS") : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function errorResponse(status, error, extraHeaders = {}) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

// ─── Executor ───────────────────────────────────────────────────────────────

export class GeminiWebExecutor extends BaseExecutor {
  constructor() {
    super("gemini-web", { id: "gemini-web", baseUrl: GEMINI_URL });
  }

  /**
   * testConnection — validates the cookie format without making a network call
   * or launching Playwright. Returns true when the cookie is non-empty and
   * contains at least one name=value pair with a non-empty value.
   */
  async testConnection(credentials) {
    try {
      const cookie = resolveGeminiWebCookie(credentials);
      if (!cookie) return false;
      const pairs = parseCookies(cookie);
      return pairs.some((p) => p.value.length > 0);
    } catch {
      return false;
    }
  }

  async execute({ model, body, stream, credentials, signal, log }) {
    const requestBody = body || {};

    // The current Gemini web client is agentic: it only uses its own built-in
    // tools (web search, weather, canvas …) and answers around prompt-level
    // tool contracts instead of emitting calls — verified live across plausible
    // and implausible tool shapes. Fail fast with a clean 400
    // rather than a doomed emulation.
    const requestedTools = requestBody.tools;
    const requestedFunctions = requestBody.functions;
    if (requestedTools != null && (!Array.isArray(requestedTools) || requestedTools.length > 0)) {
      return {
        response: errorResponse(400, "Gemini Web does not support OpenAI function tools"),
        url: GEMINI_URL,
        headers: {},
        transformedBody: body,
      };
    }
    if (requestedFunctions != null && (!Array.isArray(requestedFunctions) || requestedFunctions.length > 0)) {
      return {
        response: errorResponse(400, "Gemini Web does not support legacy function tools"),
        url: GEMINI_URL,
        headers: {},
        transformedBody: body,
      };
    }

    // `reasoning_effort` (Extended Thinking): eligible Gemini accounts DO
    // expose a real Extended Thinking toggle in the UI, so it is attempted,
    // verified via read-back, and only THEN rejected if it cannot be confirmed.
    const wantsExtendedThinking = requestsThinkingBudget(requestBody.reasoning_effort);

    const cookie = resolveGeminiWebCookie(credentials);
    if (!cookie) {
      return {
        response: errorResponse(401, "Missing Gemini cookies"),
        url: GEMINI_URL,
        headers: {},
        transformedBody: body,
      };
    }

    const messages = requestBody.messages || [];

    // gemini-web is stateless (a fresh /app page per request), so the full
    // multi-turn history is flattened into the single prompt to preserve prior
    // context across turns.
    const prompt = buildGeminiPrompt(messages);

    // A system-only request (no user message at all) must still 400 — since
    // the system text is prepended, `prompt` alone is no longer a reliable
    // "no user message" signal.
    const hasUserMessage = messages.some(
      (m) => m.role === "user" && typeof m.content === "string" && m.content.trim().length > 0
    );

    if (!prompt || !hasUserMessage) {
      return {
        response: errorResponse(400, "No user message found"),
        url: GEMINI_URL,
        headers: {},
        transformedBody: body,
      };
    }

    // Resolved up front — also drives the in-browser mode-selection step
    // below, before anything is typed.
    const modelId = model || DEFAULT_MODEL_ID;

    let browser = null;
    let context = null;
    let abortBrowser = null;
    try {
      if (signal?.aborted) {
        throw signal.reason instanceof Error ? signal.reason : new Error("Request aborted");
      }
      const { acquireGeminiBrowser } = await import("./gemini-web/browserLease.js");
      browser = await acquireGeminiBrowser(launchGeminiChromium);
      // Holder so the abort listener keeps working after the streaming path
      // moves context ownership into the ReadableStream.
      const session = { context: null };
      abortBrowser = () => {
        void session.context?.close().catch(() => {});
      };
      signal?.addEventListener("abort", abortBrowser, { once: true });

      context = await browser.newContext({
        userAgent: GEMINI_USER_AGENT,
      });
      session.context = context;

      await context.addCookies(toPlaywrightCookies(cookie, ".google.com"));

      const page = await context.newPage();

      const readQuota = await openGeminiApp(page);
      if (signal?.aborted) {
        throw signal.reason instanceof Error ? signal.reason : new Error("Request aborted");
      }
      // The composer selector is the readiness check. A fixed sleep ran even
      // when the editor was already there, and still raced a slow load.
      await waitForGeminiComposer(page, readQuota);

      // Verify the requested Gemini UI mode is actually active BEFORE anything
      // is typed. `gemini-3.1-pro` is the mode gemini.google.com/app already
      // opens to (no interaction attempted); every other advertised model is
      // switched to and its active-mode indicator is read back — a confirmed
      // match is required, or the request is rejected instead of silently
      // running the account default under the requested model's label.
      if (model) {
        const modelSelection = await selectGeminiModel(page, modelId);
        if (!modelSelection.confirmed) {
          log?.warn?.(
            "GEMINI-WEB",
            `Rejected request: could not confirm Gemini UI mode for "${modelId}" (${modelSelection.reason})`
          );
          return {
            response: errorResponse(
              400,
              {
                message: describeModeSelectionFailure(modelId, modelSelection.reason),
                type: "invalid_request_error",
                code: GEMINI_WEB_UNSUPPORTED_CONTROL_CODE,
              }
            ),
            url: GEMINI_URL,
            headers: {},
            transformedBody: body,
          };
        }
      }

      // Extended Thinking: same detect-and-verify, fail-closed pattern as
      // model selection above — attempted only when requested, never assumed
      // available.
      if (wantsExtendedThinking) {
        const thinkingSelection = await selectGeminiExtendedThinking(page);
        if (!thinkingSelection.confirmed) {
          log?.warn?.(
            "GEMINI-WEB",
            `Rejected request: could not confirm Extended Thinking is available (${thinkingSelection.reason})`
          );
          return {
            response: errorResponse(
              400,
              {
                message: describeModeSelectionFailure("Extended Thinking", thinkingSelection.reason),
                type: "invalid_request_error",
                code: GEMINI_WEB_UNSUPPORTED_CONTROL_CODE,
              }
            ),
            url: GEMINI_URL,
            headers: {},
            transformedBody: body,
          };
        }
      }

      // Type and send message
      const inputEl = await waitForGeminiComposer(page, readQuota);
      await inputEl.click();
      // insertText() dispatches a DOM `input` event atomically instead of a
      // per-character keydown/keypress/keyup sequence — an embedded `\n` in
      // `prompt` no longer fires the composer's Enter-submits-the-message
      // handler before this function's own explicit Enter below. It also
      // removes the fixed 10ms/char typing cost that made long prompts race
      // the 30s response-wait timeout.
      await page.keyboard.insertText(prompt);
      await page.waitForTimeout(300);
      await page.keyboard.press("Enter");

      // Reply capture is DOM-based (see ./gemini-web/domCapture.js): the
      // current client streams over batchexecute rpcids that Google rotates,
      // and those bodies can't be re-read via CDP once the stream completes.
      const baseReply = await readReplyState(page);

      if (hasTools) {
        const responseText = await waitForGeminiReply({
          page,
          baseCount: baseReply.count,
          baseText: baseReply.lastText,
          signal,
        });
        const cid = `chatcmpl-gwe-${crypto.randomUUID().slice(0, 12)}`;
        const created = Math.floor(Date.now() / 1000);
        const toolResponse = await buildGeminiToolResponse(
          responseText,
          requestedTools,
          Boolean(stream),
          modelId,
          cid,
          created
        );
        return { response: toolResponse, url: GEMINI_URL, headers: {}, transformedBody: body };
      }

      if (stream) {
        const encoder = new TextEncoder();
        const streamPage = page;
        const streamContext = context;
        const streamBrowser = browser;
        context = null; // ownership moves into the stream
        browser = null;
        const readable = new ReadableStream(
          {
            async start(controller) {
              try {
                await waitForGeminiReply({
                  page: streamPage,
                  baseCount: baseReply.count,
                  baseText: baseReply.lastText,
                  signal,
                  onDelta: (delta) => {
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify(formatStreamChunk(delta, modelId))}\n\n`)
                    );
                  },
                });
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(formatStreamChunk("", modelId, "stop"))}\n\n`)
                );
                controller.enqueue(encoder.encode(SSE_DONE));
                controller.close();
              } catch (error) {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ error: { message: error.message || "gemini-web stream failed" } })}\n\n`
                  )
                );
                controller.enqueue(encoder.encode(SSE_DONE));
                controller.close();
              } finally {
                await streamPage.close().catch(() => {});
                await streamContext.close().catch(() => {});
                const { releaseGeminiBrowser } = await import("./gemini-web/browserLease.js");
                await releaseGeminiBrowser(streamBrowser);
              }
            },
          },
          { highWaterMark: 16384 }
        );
        return {
          response: new Response(readable, {
            status: 200,
            headers: { ...SSE_HEADERS_NO_BUFFER },
          }),
          url: GEMINI_URL,
          headers: {},
          transformedBody: body,
        };
      }

      const responseText = await waitForGeminiReply({
        page,
        baseCount: baseReply.count,
        baseText: baseReply.lastText,
        signal,
      });
      return {
        response: new Response(JSON.stringify(formatChatCompletion(responseText, modelId)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
        url: GEMINI_URL,
        headers: {},
        transformedBody: body,
      };
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "Unknown error";
      // A missing Playwright browser is a host/config problem, not a transient
      // upstream fault. Surface an actionable error and tag it with the
      // connection-cooldown hint so accountFallback skips the provider circuit
      // breaker and applies a short, non-exponential cooldown instead of
      // looping on a retryable 500.
      if (isMissingBrowserExecutable(rawMessage)) {
        return {
          response: errorResponse(
            503,
            "Gemini Web needs a Chrome/Chromium binary. Install Google Chrome, set NINEROUTER_BROWSER_BIN " +
              "or CHROME_PATH to an existing Chrome, or run `npx playwright-core install chromium`."
          ),
          url: GEMINI_URL,
          headers: {},
          transformedBody: body,
        };
      }
      // Playwright selector/click timeout errors are terminal — they indicate
      // the page DOM does not match expectations (e.g. Gemini changed their UI
      // or the session is so expired it lands on a different page). Return 400
      // so the account-fallback system does NOT retry this request as a
      // transient 5xx.
      if (
        error instanceof Error &&
        (error.name === "TimeoutError" ||
          rawMessage.includes("waitForSelector") ||
          rawMessage.includes("Timeout") ||
          rawMessage.includes("actionability") ||
          rawMessage.includes("interception"))
      ) {
        return {
          response: errorResponse(400, rawMessage),
          url: GEMINI_URL,
          headers: {},
          transformedBody: body,
        };
      }
      return {
        response: errorResponse(500, rawMessage),
        url: GEMINI_URL,
        headers: {},
        transformedBody: body,
      };
    } finally {
      if (abortBrowser) signal?.removeEventListener("abort", abortBrowser);
      // Close this request's context. The Chromium process stays warm until it
      // has been idle.
      try {
        await context?.close();
      } catch {
        /* ignore close errors */
      }
      if (browser) {
        const { releaseGeminiBrowser } = await import("./gemini-web/browserLease.js");
        await releaseGeminiBrowser(browser);
      }
    }
  }

  /**
   * Generate image(s) through the Gemini web UI's built-in image generation,
   * then download the rendered image in-page as base64.
   * Used by the /v1/images/generations adapter.
   *
   * @returns {Promise<Array<{ b64: string, mime: string, width?: number, height?: number }>>}
   */
  async generateMedia({ prompt, n = 1, size, credentials, signal, log }) {
    if (!prompt) throw new Error("prompt is required for image generation");
    const cookie = resolveGeminiWebCookie(credentials);
    if (!cookie) throw new Error("Missing Gemini cookies");

    const results = [];
    for (let i = 0; i < Math.max(1, n); i++) {
      let browser = null;
      let context = null;
      try {
        const { acquireGeminiBrowser } = await import("./gemini-web/browserLease.js");
        browser = await acquireGeminiBrowser(launchGeminiChromium);
        context = await browser.newContext({ userAgent: GEMINI_USER_AGENT });
        await context.addCookies(toPlaywrightCookies(cookie, ".google.com"));
        const page = await context.newPage();
        const readQuota = await openGeminiApp(page);
        const inputEl = await waitForGeminiComposer(page, readQuota);
        await inputEl.click();
        await page.keyboard.insertText(buildImagePrompt(prompt, size));
        await page.waitForTimeout(300);
        await page.keyboard.press("Enter");
        const media = await waitForGeminiImage(page, { signal });
        results.push(media);
      } finally {
        try {
          await context?.close();
        } catch {
          /* ignore close errors */
        }
        if (browser) {
          const { releaseGeminiBrowser } = await import("./gemini-web/browserLease.js");
          await releaseGeminiBrowser(browser);
        }
      }
    }
    return results;
  }
}

export default GeminiWebExecutor;
