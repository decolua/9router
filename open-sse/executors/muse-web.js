// MuseWebExecutor — muse.ai Hatch (muse.ai) session provider
//
// Routes requests through muse.ai's Hatch web client using browser cookies +
// Playwright DOM automation. The Hatch agent runs in a cloud VM: chat replies
// stream into the agent bubble, and image/video requests finish as inline
// attachments that are downloaded in-page as base64.
//
// Auth: cookie-based (hatch_sess + rotating hatch_gw/hatch_vml/...) from muse.ai
// Method: /api/session renewal (plain HTTP) + Playwright DOM automation
//
// Session renewal rotates the cookie jar via Set-Cookie on every request; the
// rotated jar is re-seeded into the pooled browser context each time.

import { createHash } from "node:crypto";
import { BaseExecutor } from "./base.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { isMissingBrowserExecutable, resolveSystemChromeExecutable } from "./browserExecutableCheck.js";
import { acquireBrowserContext, releaseBrowserContext } from "../services/browserPool.js";
import {
  NEW_THREAD_URL,
  parseCookiePairs,
  toMuseCookies,
  renewSession,
  MuseWebAuthError,
  MuseWebUpstreamError,
  MuseWebQuotaError,
  MuseWebTimeoutError,
} from "./muse-web/session.js";
import { flattenMessages } from "./muse-web/prompt.js";
import * as dom from "./muse-web/dom.js";

export { isMissingBrowserExecutable } from "./browserExecutableCheck.js";

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_MODEL_ID = "muse-chat";

const PAGE_READY_TIMEOUT_MS = 45000;
const POLL_INTERVAL_MS = 300;
// Polls with unchanged text before the reply counts as finished. FORCE fires
// even while the stop button is still up (the UI occasionally leaves it stuck).
const STABLE_POLLS_DONE = 4;
const STABLE_POLLS_FORCE = 12;
const STALL_AFTER_MS = 15000;
const FIRST_TOKEN_TIMEOUT_MS = 45000;
const CHAT_TIMEOUT_MS = 300000;

// muse.ai posts a completion sentence ("Here's your video…") a few seconds
// before the media attachment's blob src is ready, so a reply that is "text
// only" right now may still be finalising. Keep waiting this long for the
// attachment to appear/load before treating the reply as a refusal.
const MEDIA_GRACE = { video: 90000, image: 8000 };
// The timeout is soft while muse.ai is visibly still working (stop button
// shown or attachment loading): giving up then threw away images that landed
// a minute later, and the failover started the whole generation over.
const OVERRUN_FACTOR = 2.5;
const MEDIA_POLL_MS = 600;
const IMAGE_TIMEOUT_MS = 240000;
const VIDEO_TIMEOUT_MS = 600000;
const MAX_CHAT_IMAGES = 8;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatChatCompletion(content, model, finishReason = "stop") {
  return {
    id: `chatcmpl-muw-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: finishReason,
        logprobs: null,
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

function formatStreamChunk(content, model, finishReason = null) {
  return {
    id: `chatcmpl-muw-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta: content ? { content } : {}, finish_reason: finishReason }],
  };
}

function errorResponse(status, error, extraHeaders = {}) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

function resolveMuseCookie(credentials) {
  const direct = String(credentials?.apiKey ?? "").trim() || String(credentials?.cookie ?? "").trim();
  if (direct) return direct;
  const providerSpecificData = credentials?.providerSpecificData;
  if (providerSpecificData && typeof providerSpecificData === "object" && !Array.isArray(providerSpecificData)) {
    return String(providerSpecificData.cookie ?? "").trim();
  }
  return "";
}

/** Map a flow error to the HTTP status the fallback layer should see. */
function statusForError(error) {
  if (error instanceof MuseWebAuthError) return 401;
  if (error instanceof MuseWebQuotaError) return 429;
  if (error instanceof MuseWebTimeoutError) return 504;
  if (error instanceof MuseWebUpstreamError) return 502;
  if (error?.name === "AbortError" || /aborted/i.test(error?.message || "")) return 499;
  return 500;
}

async function waitForThreadReady(page) {
  const deadline = Date.now() + PAGE_READY_TIMEOUT_MS;
  let state = {};
  while (Date.now() < deadline) {
    await sleep(250);
    // A busy page can leave evaluate unanswered while it loads; poll again.
    try {
      state = (await page.evaluate(dom.PAGE_STATE)) || {};
      if (state.ready) return state;
    } catch {
      /* page navigating — poll again */
    }
  }
  const head = (state.head || "").toLowerCase();
  if (dom.LOGIN_HINTS.some((h) => head.includes(h))) {
    throw new MuseWebAuthError("muse.ai redirected to login; cookies are no longer valid");
  }
  throw new MuseWebTimeoutError("muse.ai page did not become ready");
}

async function readChatState(page) {
  const state = (await page.evaluate(dom.CHAT_STATE)) || {};
  const tail = state.tail || "";
  const low = tail.toLowerCase();
  const hit = dom.QUOTA_HINTS.find((h) => low.includes(h));
  if (hit) {
    const i = low.indexOf(hit);
    const snippet = tail.slice(Math.max(0, i - 120), i + 120).trim().split(/\s+/).join(" ");
    // The page tail also holds the prompt and the thread-history sidebar, and
    // matching it cooled down accounts whose images muse.ai went on to deliver.
    // Only a finished agent reply that says so counts.
    const reply = state.lastText || "";
    if (!state.generating && reply.toLowerCase().includes(hit)) {
      throw new MuseWebQuotaError(`muse.ai reports the account is out of quota: …${snippet}…`);
    }
  }
  return state;
}

async function denyApprovals(page) {
  await page.evaluate(dom.DENY_APPROVALS);
}

async function sendPrompt(page, prompt) {
  const res = await page.evaluate(dom.fillInputScript(prompt));
  if (!res?.ok) throw new MuseWebUpstreamError(`cannot fill muse.ai chat input: ${res?.err}`);
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if ((await page.evaluate(dom.CLICK_SEND)) === "clicked") return;
    await sleep(100);
  }
  await page.keyboard.press("Enter");
  await sleep(500);
  if (!(await page.evaluate(dom.INPUT_EMPTY))) {
    throw new MuseWebUpstreamError("send button not found and Enter did not submit");
  }
}

async function resolveImageRef(ref) {
  const dataUri = String(ref).match(/^data:(image\/[^;]+);base64,(.+)$/);
  if (dataUri) return { b64: dataUri[2], mime: dataUri[1] };
  if (/^https?:/i.test(ref)) {
    // Some hosts (CDNs, wikimedia) reject the default undici UA with 4xx.
    const r = await fetch(ref, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
        Accept: "image/*",
      },
    });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    const mime = (r.headers.get("content-type") || "").split(";")[0].trim() || "image/png";
    if (!mime.startsWith("image/")) return null;
    return { b64: buf.toString("base64"), mime };
  }
  return null;
}

async function attachImages(page, images) {
  if (!images?.length) return 0;
  let attached = 0;
  let failed = 0;
  for (const [idx, ref] of images.slice(0, MAX_CHAT_IMAGES).entries()) {
    const img = await resolveImageRef(ref).catch(() => null);
    if (!img) {
      failed++;
      continue;
    }
    const ext = (img.mime.split("/")[1] || "png").replace("jpeg", "jpg");
    const res = await page.evaluate(dom.attachFileScript(img.b64, img.mime, `input_${idx}.${ext}`));
    if (!res?.ok) throw new MuseWebUpstreamError(`failed to attach image: ${res?.err}`);
    attached++;
  }
  // Every ref failed to resolve — the caller asked for images that never
  // arrived. Fail fast instead of sending a text-only prompt the agent
  // answers with "which image?" (which burns a multi-minute video turn).
  if (!attached && failed > 0) {
    throw new MuseWebUpstreamError(
      `could not download any input image (${failed} failed — check the URLs)`
    );
  }
  if (attached) await sleep(1000);
  return attached;
}

/**
 * Poll the agent bubble and emit text deltas until the reply is stable.
 *
 * Completion is text-stability based (the stop button sticks): unchanged text
 * for STABLE_POLLS_DONE polls while not generating, or STABLE_POLLS_FORCE
 * polls regardless. `onDelta` (when given) receives each incremental chunk.
 */
async function pollChat({ page, base, signal, onDelta }) {
  const baseCount = base.agentCount || 0;
  const baseText = base.lastText || "";
  const started = Date.now();
  let emitted = "";
  let last = null;
  let stable = 0;
  let gotFirst = false;

  while (true) {
    if (signal?.aborted) throw new Error("Request aborted");
    const elapsed = Date.now() - started;
    if (elapsed > CHAT_TIMEOUT_MS) throw new MuseWebTimeoutError("assistant reply timed out");
    if (!gotFirst && elapsed > FIRST_TOKEN_TIMEOUT_MS) {
      throw new MuseWebTimeoutError("no first token from assistant");
    }
    await sleep(POLL_INTERVAL_MS);

    const st = await readChatState(page);
    if (st.approval) {
      await denyApprovals(page);
      continue;
    }
    const text = st.lastText || "";
    const isNew = (st.agentCount || 0) > baseCount || (text && text !== baseText);
    if (!isNew || !text) {
      const tail = st.tail || "";
      if (elapsed > STALL_AFTER_MS && dom.STALL_HINTS.some((h) => tail.includes(h))) {
        throw new MuseWebTimeoutError("upstream workspace is stuck connecting");
      }
      continue;
    }
    gotFirst = true;
    if (text !== last) {
      const delta = text.startsWith(emitted) ? text.slice(emitted.length) : text;
      if (delta) {
        emitted = text;
        onDelta?.(delta);
      }
      last = text;
      stable = 0;
    } else {
      stable++;
      if ((!st.generating && stable >= STABLE_POLLS_DONE) || stable >= STABLE_POLLS_FORCE) {
        return emitted;
      }
    }
  }
}

function buildMediaPrompt(prompt, kind, size, duration, hasImage) {
  const hints = [];
  if (size) hints.push(`aspect ratio ${size}`);
  if (duration) hints.push(`${duration} seconds long`);
  const verb =
    kind === "image"
      ? "Generate an image"
      : hasImage
        ? "Animate the attached image into a video"
        : "Generate a video";
  const suffix = hints.length ? ` (${hints.join(", ")})` : "";
  return `${verb}${suffix}: ${prompt}`;
}

const VIDEO_EXT = [".mp4", ".webm", ".mov", ".m4v"];
const IMAGE_EXT = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"];
const MEDIA_HOSTS = [
  "videodelivery.net",
  "cloudflarestream.com",
  "cloudflarestorage.com",
  "amazonaws.com",
  "storage.googleapis.com",
  "blob.core.windows.net",
  "musecdn",
  "cdn.muse",
  "muse-cdn",
];
const MEDIA_PATHS = ["/media/", "/download", "/dl/", "/video", "/attachment", "/files/"];

/** Best media URL from a reply bubble, or null if nothing looks like one. */
function pickMediaUrl(links, kind) {
  const exts = kind === "video" ? VIDEO_EXT : IMAGE_EXT;
  const score = (u) => {
    const low = u.toLowerCase();
    const path = low.split("?")[0].split("#")[0];
    if (u.startsWith("blob:") || exts.some((e) => path.endsWith(e))) return 3;
    if (MEDIA_HOSTS.some((h) => low.includes(h))) return 2;
    if (MEDIA_PATHS.some((seg) => low.includes(seg))) return 1;
    return 0;
  };
  const cands = links.filter((u) => u && !u.startsWith("mailto:") && !u.startsWith("javascript:"));
  cands.sort((a, b) => score(b) - score(a));
  return cands.length && score(cands[0]) > 0 ? cands[0] : null;
}

/**
 * Wait for the generated media to land as an inline attachment. Falls back, in
 * order, to asking the agent to attach the file (it often leaves the final
 * file only in its workspace), then to a media link inside the reply bubble.
 */
async function waitForMedia({ page, base, kind, timeoutMs, signal, log }) {
  const baseAtts = (base.attachments || []).length;
  let baseCount = base.agentCount || 0;
  const grace = MEDIA_GRACE[kind] ?? 8000;
  const started = Date.now();
  let textDoneAt = null;
  let denied = false;
  let askedToAttach = false;
  let busy = false;
  let elapsed = 0;

  while (true) {
    elapsed = Date.now() - started;
    if (elapsed >= timeoutMs && !(busy && elapsed < timeoutMs * OVERRUN_FACTOR)) break;
    if (signal?.aborted) throw new Error("Request aborted");
    await sleep(MEDIA_POLL_MS);

    const st = await readChatState(page);
    if (st.approval) {
      await denyApprovals(page);
      denied = true;
      textDoneAt = null;
      continue;
    }
    const newAtts = (st.attachments || []).slice(baseAtts);
    const fresh = newAtts.filter((a) => a.src && a.kind === kind);
    if (fresh.length) return fresh[fresh.length - 1];

    busy = Boolean(st.generating) || newAtts.some((a) => (a.tid || "").includes(kind));
    // An attachment node for this kind is on the page but its (blob) src has
    // not loaded yet -> media is still finalising, keep waiting.
    if (newAtts.some((a) => (a.tid || "").includes(kind))) {
      textDoneAt = null;
      continue;
    }
    // No attachment yet. The reply may be genuinely text-only (a refusal), or
    // the attachment may simply lag the completion sentence.
    const text = st.lastText || "";
    if ((st.agentCount || 0) > baseCount && text && !st.generating) {
      if (textDoneAt === null) {
        textDoneAt = Date.now();
      } else if (Date.now() - textDoneAt >= grace) {
        if (!askedToAttach) {
          log?.info?.(
            "MUSE-WEB",
            `${kind} not attached (${denied ? "denied approval" : "text-only reply"}); asking for it in chat`
          );
          await sendPrompt(
            page,
            `Please attach the final ${kind} file here in the chat` +
              (denied ? " instead of uploading it." : ", as a single attachment.")
          );
          askedToAttach = true;
          textDoneAt = null;
          baseCount = st.agentCount || 0;
          continue;
        }
        const probe = (await page.evaluate(dom.LAST_BUBBLE_MEDIA).catch(() => null)) || {};
        const url = pickMediaUrl(probe.links || [], kind);
        if (url) {
          log?.info?.("MUSE-WEB", `${kind} delivered as link in text bubble`);
          return { src: url, kind };
        }
        throw new MuseWebUpstreamError(`muse.ai replied with text only: ${text.slice(0, 200)}`);
      }
    } else {
      textDoneAt = null;
    }
  }
  if (busy) log?.warn?.("MUSE-WEB", `${kind} still generating after ${Math.round(elapsed / 1000)}s; giving up`);
  throw new MuseWebTimeoutError(`${kind} generation timed out`);
}

async function downloadMedia(page, att, kind) {
  const res = await page.evaluate(dom.fetchAsBase64Script(att.src));
  if (!res?.ok) {
    throw new MuseWebUpstreamError(`failed to download generated ${kind}: ${res?.err}`);
  }
  return { b64: res.b64, mime: res.mime || (kind === "video" ? "video/mp4" : "image/png") };
}

// ─── Executor ───────────────────────────────────────────────────────────────

export class MuseWebExecutor extends BaseExecutor {
  constructor() {
    super("muse-web", { id: "muse-web", baseUrl: "https://muse.ai" });
  }

  /**
   * testConnection — validates the cookie format without a network call or a
   * browser launch. hatch_sess is the only long-lived identifying cookie (the
   * others rotate via /api/session), so it must be present.
   */
  async testConnection(credentials) {
    try {
      const raw = resolveMuseCookie(credentials);
      if (!raw) return false;
      const pairs = parseCookiePairs(raw);
      return pairs.some((p) => p.name === "hatch_sess" && p.value.length > 0);
    } catch {
      return false;
    }
  }

  /**
   * Renew the session over plain HTTP, acquire the pooled browser context
   * seeded with the rotated cookies, and open a ready /thread/new page.
   */
  async _openThreadPage(credentials, { signal, log }) {
    const rawCookie = resolveMuseCookie(credentials);
    if (!rawCookie) throw new MuseWebAuthError("Missing muse.ai cookies");

    const session = await renewSession(rawCookie, { signal });
    log?.debug?.(
      "MUSE-WEB",
      `session renewed (status=${session.meta.session_status ?? "?"}, vm=${session.meta.vm_state ?? "?"})`
    );

    const key = `muse-web:${createHash("sha256").update(rawCookie).digest("hex").slice(0, 16)}`;
    const executablePath = resolveSystemChromeExecutable();
    let pooled = await acquireBrowserContext(key, {
      cookieDomain: ".muse.ai",
      cookieString: session.cookieHeader,
      ...(executablePath ? { executablePath } : {}),
    });
    // Re-seed the pooled context with the freshly rotated cookies every
    // request; seeding at creation alone would go stale as muse.ai rotates.
    try {
      await pooled.context.addCookies(toMuseCookies(session.cookieHeader));
    } catch {
      await releaseBrowserContext(key);
      pooled = await acquireBrowserContext(key, {
        cookieDomain: ".muse.ai",
        cookieString: session.cookieHeader,
        ...(executablePath ? { executablePath } : {}),
      });
    }

    const page = await pooled.context.newPage();
    await page.goto(NEW_THREAD_URL, { waitUntil: "domcontentloaded", timeout: PAGE_READY_TIMEOUT_MS });
    await waitForThreadReady(page);
    return { key, page };
  }

  async execute({ model, body, stream, credentials, signal, log }) {
    const requestBody = body || {};
    const messages = requestBody.messages || [];
    const modelId = model || DEFAULT_MODEL_ID;

    // The muse.ai Hatch agent only uses its own built-in tools (web search,
    // image generation) and explicitly ignores prompt-level tool contracts —
    // verified live: it answers around them instead of emitting calls. Fail
    // fast with a clean 400 rather than a doomed emulation.
    const requestedTools = requestBody.tools;
    const requestedFunctions = requestBody.functions;
    if (requestedTools != null && (!Array.isArray(requestedTools) || requestedTools.length > 0)) {
      return {
        response: errorResponse(400, "Muse Web does not support OpenAI function tools"),
        url: "https://muse.ai",
        headers: {},
        transformedBody: body,
      };
    }
    if (requestedFunctions != null && (!Array.isArray(requestedFunctions) || requestedFunctions.length > 0)) {
      return {
        response: errorResponse(400, "Muse Web does not support legacy function tools"),
        url: "https://muse.ai",
        headers: {},
        transformedBody: body,
      };
    }

    const { text: flatPrompt, images } = flattenMessages(messages);

    if (!flatPrompt) {
      return {
        response: errorResponse(400, "No user message found"),
        url: "https://muse.ai",
        headers: {},
        transformedBody: body,
      };
    }

    let page = null;
    const onAbort = () => {
      page?.close().catch(() => {});
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      // Setup phase runs eagerly so auth/ready failures return a real HTTP
      // status instead of a stream that errors on first read.
      const opened = await this._openThreadPage(credentials, { signal, log });
      page = opened.page;

      const base = await readChatState(page);
      await attachImages(page, images);
      await sendPrompt(page, flatPrompt);

      const closePage = async () => {
        signal?.removeEventListener("abort", onAbort);
        await page?.close().catch(() => {});
      };

      if (stream) {
        const encoder = new TextEncoder();
        const streamPage = page;
        page = null; // ownership moves into the stream
        const readable = new ReadableStream(
          {
            async start(controller) {
              try {
                await pollChat({
                  page: streamPage,
                  base,
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
                    `data: ${JSON.stringify({ error: { message: error.message || "muse-web stream failed" } })}\n\n`
                  )
                );
                controller.enqueue(encoder.encode(SSE_DONE));
                controller.close();
              } finally {
                signal?.removeEventListener("abort", onAbort);
                await streamPage.close().catch(() => {});
              }
            },
          },
          { highWaterMark: 16384 }
        );
        return {
          response: new Response(readable, { status: 200, headers: { ...SSE_HEADERS_NO_BUFFER } }),
          url: "https://muse.ai",
          headers: {},
          transformedBody: body,
        };
      }

      const responseText = await pollChat({ page, base, signal });
      await closePage();
      return {
        response: new Response(JSON.stringify(formatChatCompletion(responseText, modelId)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
        url: "https://muse.ai",
        headers: {},
        transformedBody: body,
      };
    } catch (error) {
      signal?.removeEventListener("abort", onAbort);
      await page?.close().catch(() => {});
      const message = error instanceof Error ? error.message : "Unknown error";

      // A missing Playwright browser is a host/config problem, not a transient
      // upstream fault. Actionable error + cooldown hint so accountFallback
      // applies a short cooldown instead of looping on a retryable 500.
      if (isMissingBrowserExecutable(message)) {
        return {
          response: errorResponse(
            503,
            "Muse Web needs a Chrome/Chromium binary. Install Google Chrome, set NINEROUTER_BROWSER_BIN " +
              "or CHROME_PATH to an existing Chrome, or run `npx playwright-core install chromium`."
          ),
          url: "https://muse.ai",
          headers: {},
          transformedBody: body,
        };
      }
      // DOM/selector timeouts are terminal — muse.ai shipped a UI change or the
      // session is so stale the page is somewhere else entirely. 400 keeps the
      // fallback layer from retrying it as a transient 5xx.
      if (
        error instanceof Error &&
        (error.name === "TimeoutError" || message.includes("waitForSelector") || message.includes("actionability"))
      ) {
        return {
          response: errorResponse(400, message),
          url: "https://muse.ai",
          headers: {},
          transformedBody: body,
        };
      }
      return {
        response: errorResponse(statusForError(error), message),
        url: "https://muse.ai",
        headers: {},
        transformedBody: body,
      };
    }
  }

  /**
   * Generate image (or video) media. Media always starts a fresh thread.
   * Used by the /v1/images/generations adapter (handlers/imageProviders/muse-web.js).
   *
   * @returns {Promise<Array<{ b64: string, mime: string, width?: number, height?: number }>>}
   */
  async generateMedia({ prompt, kind = "image", size, duration, n = 1, images, credentials, signal, log }) {
    if (!prompt) throw new MuseWebUpstreamError("prompt is required for media generation");
    const mediaPrompt = buildMediaPrompt(prompt, kind, size, duration, Boolean(images?.length));
    const timeoutMs = kind === "video" ? VIDEO_TIMEOUT_MS : IMAGE_TIMEOUT_MS;
    const results = [];

    for (let i = 0; i < Math.max(1, n); i++) {
      const { page } = await this._openThreadPage(credentials, { signal, log });
      try {
        const base = await readChatState(page);
        if (images?.length) await attachImages(page, images);
        await sendPrompt(page, mediaPrompt);
        const att = await waitForMedia({ page, base, kind, timeoutMs, signal, log });
        const media = await downloadMedia(page, att, kind);
        results.push({
          b64: media.b64,
          mime: media.mime,
          ...(att.w ? { width: att.w } : {}),
          ...(att.h ? { height: att.h } : {}),
        });
      } finally {
        await page.close().catch(() => {});
      }
    }
    return results;
  }
}

export default MuseWebExecutor;
