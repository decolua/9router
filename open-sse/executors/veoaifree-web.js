// veoaifree.com free media generator — WordPress AJAX API, no auth needed.
// Rate limited (~6 requests/hour per IP). Video: full-video-generate →
// final-video-results polling → mp4 artifact download. Image: nano-banana
// generator returning URLs or raw base64 parts. Ported from OmniRoute.
import dns from "node:dns";
import { isIP } from "node:net";
import { BaseExecutor } from "./base.js";

const BASE_URL = "https://veoaifree.com";
const AJAX_URL = `${BASE_URL}/wp-admin/admin-ajax.php`;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const POLL_INTERVAL_MS = 20000;
const MAX_POLLS = 30; // 10 minutes
const FETCH_TIMEOUT_MS = 30000;
const ARTIFACT_MAX_BYTES = 100 * 1024 * 1024;
const ARTIFACT_MAX_REDIRECTS = 3;
const ARTIFACT_READY_MAX_ATTEMPTS = 12;
const ARTIFACT_READY_RETRY_INTERVAL_MS = 5000;
const RETRYABLE_ARTIFACT_STATUSES = new Set([202, 404, 409, 425]);

function isPrivateAddress(addr) {
  const raw = String(addr).toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = raw.startsWith("::ffff:") ? raw.slice(7) : raw;
  if (mapped.includes(".")) {
    const [o1, o2] = mapped.split(".").map(Number);
    return o1 === 0 || o1 === 10 || o1 === 127 || o1 >= 224 ||
      (o1 === 172 && o2 >= 16 && o2 <= 31) ||
      (o1 === 192 && o2 === 168) ||
      (o1 === 169 && o2 === 254);
  }
  // IPv6: loopback, unique-local fc00::/7, link-local fe80::/10.
  return mapped === "::1" || mapped.startsWith("fc") || mapped.startsWith("fd") || mapped.startsWith("fe80") || mapped.startsWith("fe9") || mapped.startsWith("fea") || mapped.startsWith("feb");
}

async function assertPublicHost(hostname) {
  const bare = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  if (isIP(bare)) {
    if (isPrivateAddress(bare)) throw new Error("artifact host is a blocked address");
    return;
  }
  const resolved = await dns.promises.lookup(bare, { all: true }).catch(() => []);
  if (!resolved.length) throw new Error("artifact host could not be resolved");
  for (const { address } of resolved) {
    if (isPrivateAddress(address)) throw new Error("artifact host resolves to a blocked address");
  }
}

function buildContext(signal) {
  return { cookieHeader: "", signal };
}

function mergeSetCookies(context, response) {
  const setCookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : (response.headers.get("set-cookie") ? [response.headers.get("set-cookie")] : []);
  if (!setCookies.length) return;
  const jar = new Map(context.cookieHeader.split(";").filter(Boolean).map((part) => {
    const eq = part.trim().indexOf("=");
    return eq > 0 ? [part.trim().slice(0, eq), part.trim().slice(eq + 1)] : null;
  }).filter(Boolean));
  for (const setCookie of setCookies) {
    const pair = setCookie.split(";")[0]?.trim();
    const eq = pair?.indexOf("=");
    if (eq > 0 && pair.slice(eq + 1)) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
  }
  context.cookieHeader = [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function sessionFetch(context, url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("veoaifree request timed out")), FETCH_TIMEOUT_MS);
  const abort = () => controller.abort(context.signal?.reason || new Error("aborted"));
  if (context.signal?.aborted) abort();
  else context.signal?.addEventListener("abort", abort, { once: true });
  try {
    const headers = {
      "User-Agent": USER_AGENT,
      Referer: `${BASE_URL}/`,
      ...(init.headers || {}),
    };
    if (context.cookieHeader && headers.Cookie === undefined) headers.Cookie = context.cookieHeader;
    const response = await fetch(url, { ...init, headers, signal: controller.signal });
    mergeSetCookies(context, response);
    return response;
  } finally {
    clearTimeout(timer);
    context.signal?.removeEventListener("abort", abort);
  }
}

async function fetchNonce(context) {
  const res = await sessionFetch(context, BASE_URL);
  const html = await res.text();
  const match = html.match(/nonce":"([a-f0-9]+)"/);
  if (!match) throw new Error("failed to extract CSRF nonce from veoaifree.com (site layout changed or rate limited)");
  return match[1];
}

async function postAjax(context, nonce, params) {
  const body = new URLSearchParams({ action: "veo_video_generator", nonce, ...params });
  const res = await sessionFetch(context, AJAX_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: BASE_URL },
    body: body.toString(),
  });
  return res.text();
}

function mapAspectRatio(size, prefix) {
  const value = String(size || "").toLowerCase();
  if (/9:16|portrait/.test(value)) return `${prefix}_PORTRAIT`;
  if (/1:1|square/.test(value)) return `${prefix}_SQUARE`;
  return `${prefix}_LANDSCAPE`; // default 16:9
}

async function downloadArtifact(context, artifactUrl) {
  let currentUrl = artifactUrl;
  for (let redirect = 0; redirect <= ARTIFACT_MAX_REDIRECTS; redirect++) {
    const url = new URL(currentUrl);
    if (url.protocol !== "https:") throw new Error("artifact URL must use HTTPS");
    await assertPublicHost(url.hostname);
    const response = await sessionFetch(context, url.toString(), { method: "GET", redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("artifact redirect is missing a destination");
      currentUrl = new URL(location, url.toString()).toString();
      continue;
    }
    if (RETRYABLE_ARTIFACT_STATUSES.has(response.status)) throw Object.assign(new Error("artifact not available yet"), { retryable: true });
    if (!response.ok) throw new Error(`artifact download failed (HTTP ${response.status})`);
    const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!["video/mp4", "application/octet-stream"].includes(contentType)) {
      throw new Error(`artifact returned unsupported content type (${contentType})`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > ARTIFACT_MAX_BYTES) throw new Error("artifact exceeds 100MB limit");
    if (buffer.length < 12 || buffer.toString("ascii", 4, 8) !== "ftyp") throw new Error("artifact is not a valid MP4 file");
    return buffer;
  }
  throw new Error("artifact exceeded the redirect limit");
}

async function downloadArtifactWithRetry(context, artifactUrl) {
  let lastError = null;
  for (let attempt = 0; attempt < ARTIFACT_READY_MAX_ATTEMPTS; attempt++) {
    try {
      return await downloadArtifact(context, artifactUrl);
    } catch (error) {
      if (!error.retryable) throw error;
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, ARTIFACT_READY_RETRY_INTERVAL_MS));
    }
  }
  throw lastError || new Error("artifact did not become available in time");
}

export class VeoAiFreeWebExecutor extends BaseExecutor {
  constructor() {
    super("veoaifree-web", { id: "veoaifree-web", baseUrl: BASE_URL });
  }

  async execute() {
    return {
      response: new Response(JSON.stringify({
        error: { message: "veoaifree-web is a media provider — use /v1/images/generations or /v1/videos/generations", type: "invalid_request" },
      }), { status: 400, headers: { "Content-Type": "application/json" } }),
      url: AJAX_URL, headers: {}, transformedBody: {},
    };
  }

  async generateMedia({ prompt, kind = "video", size, credentials, signal, log }) {
    if (kind !== "video" && kind !== "image") throw new Error("veoaifree-web supports image and video generation only");
    if (!prompt?.trim()) throw new Error("prompt is required");
    const context = buildContext(signal);
    const nonce = await fetchNonce(context);

    if (kind === "image") {
      const result = await postAjax(context, nonce, {
        promptIMG: prompt,
        totalVariationsIMG: "1",
        aspectRatioIMG: mapAspectRatio(size, "IMAGE_ASPECT_RATIO"),
        actionType: "banan-image-generator",
      });
      const trimmed = result.trim();
      if (!trimmed || trimmed === "0" || trimmed.toLowerCase().includes("error")) {
        throw new Error(`veoaifree image generation failed: ${trimmed.slice(0, 120)}`);
      }
      return trimmed.split(",").map((part) => part.trim()).filter(Boolean).map((part) => (
        /^https?:\/\//i.test(part) ? { url: part } : { b64: part, mime: "image/png" }
      ));
    }

    const genResult = await postAjax(context, nonce, {
      prompt,
      totalVariations: "1",
      aspectRatio: mapAspectRatio(size, "VIDEO_ASPECT_RATIO"),
      actionType: "full-video-generate",
    });
    const sceneData = genResult.trim();
    if (!sceneData || sceneData === "0" || sceneData.toLowerCase().includes("error")) {
      throw new Error(`veoaifree video submit failed: ${sceneData.slice(0, 120)}`);
    }

    for (let poll = 0; poll < MAX_POLLS; poll++) {
      if (signal?.aborted) throw new Error("aborted");
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      const pollResult = (await postAjax(context, nonce, { sceneData, actionType: "final-video-results" })).trim();
      if (!pollResult || pollResult === "0" || pollResult.toLowerCase().includes("error")) continue;
      const url = pollResult.split(/[,\n]/).map((part) => part.trim()).find((part) => /^https?:\/\//i.test(part));
      if (!url) continue;
      const buffer = await downloadArtifactWithRetry(context, url);
      log?.info?.("VEOAI-FREE", `video ready after ${poll + 1} poll(s)`);
      return [{ b64: buffer.toString("base64"), mime: "video/mp4" }];
    }
    throw new Error("veoaifree video generation timed out after 10 minutes");
  }
}

export default VeoAiFreeWebExecutor;
