// UC (uncensored.com) persona-web provider — image + video via the
// un-metered internal API. Credential: the full uncensored.com cookie header
// (must include the durable Clerk `__client` cookie). A short-lived `__session`
// JWT is minted from Clerk per request; the account uid comes from the minted
// token's claims. Ported from OmniRoute's uc persona paths.
import { BaseExecutor } from "./base.js";

const UC_ORIGIN = "https://uncensored.com";
const UC_CLERK_FAPI = "https://clerk.uncensored.com";
const UC_CLERK_JS_VERSION = "5.127.1";
const UC_IMAGE_URL = "https://internal.chatuncensored.ai/v2/image-gen";
const UC_VIDEO_URL = "https://internal.chatuncensored.ai/image_to_video";
const UC_SIGNED_URL = "https://internal-6.pubyar.com/generate-signed-url";
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 300000;

const UC_IMAGE_MODE = "dev";
const UC_MODERATION_MODE = "SUPER_LIGHT";
const UC_COUNTRY = "US";
const UC_DEFAULT_IMAGE_MODEL = "seedream-v4.5";
const UC_DEFAULT_VIDEO_MODEL = "default";

// aspect_ratio → pixel size accepted by /v2/image-gen for the generic models.
const UC_ASPECT_SIZES = {
  "1:1": { imageWidth: "1024", imageHeight: "1024" },
  "16:9": { imageWidth: "1024", imageHeight: "576" },
  "9:16": { imageWidth: "576", imageHeight: "1024" },
  "4:3": { imageWidth: "1024", imageHeight: "768" },
  "3:4": { imageWidth: "768", imageHeight: "1024" },
  "3:2": { imageWidth: "1152", imageHeight: "768" },
  "2:3": { imageWidth: "768", imageHeight: "1152" },
  "4:5": { imageWidth: "896", imageHeight: "1120" },
  "5:4": { imageWidth: "1120", imageHeight: "896" },
  "21:9": { imageWidth: "1344", imageHeight: "576" },
};

/**
 * Text-to-image catalog accepted by `model_version` on /v2/image-gen.
 * `aspects` lists the ratios the upstream honours; empty = any ratio.
 */
const UC_IMAGE_MODELS = {
  "seedream-v4.5": { name: "Seedream v4.5", aspects: ["1:1", "16:9", "9:16", "4:3", "3:4"] },
  "seedream-v5": { name: "Seedream v5", aspects: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"] },
  "seedream-v5-flash": { name: "Seedream v5 Flash", aspects: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "4:5", "5:4", "21:9"], resolutions: ["1k", "1.5k", "2k"] },
  "nano-banana-pro-ultra": { name: "Nano Banana Pro Ultra", aspects: ["1:1", "3:2", "2:3", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"], resolutions: ["4k", "8k"] },
  "nano-banana-pro": { name: "Nano Banana Pro", aspects: ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"], resolutions: ["1k", "2k", "4k"] },
  "nano-banana": { name: "Nano Banana", aspects: ["1:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "5:4", "4:5", "21:9"] },
  "nano-banana-2": { name: "Nano Banana 2", aspects: ["1:1", "3:2", "2:3", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"], resolutions: ["1k", "2k", "4k"] },
  "gpt-image": { name: "GPT Image 1.5", aspects: ["1:1", "2:3", "3:2"], qualities: ["medium", "high"] },
  "gpt-image-2": { name: "GPT Image 2", aspects: ["1:1", "3:2", "2:3", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"] },
  "gpt-image-2.5-flare": { name: "GPT Image 2.5 Flare", aspects: ["1:1", "3:2", "2:3", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9", "2:1", "1:2", "3:1", "1:3", "9:21"] },
  "gpt-image-2.5-sunburst": { name: "GPT Image 2.5 Sunburst", aspects: ["1:1", "3:2", "2:3", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9", "2:1", "1:2", "3:1", "1:3", "9:21"] },
  "wan-2.6": { name: "Wan 2.6", aspects: ["1:1", "4:3", "3:4", "3:2", "2:3"] },
  // Registry id is disambiguated from the video model of the same upstream name.
  "wan-2.6-image": { name: "Wan 2.6", upstream: "wan-2.6", aspects: ["1:1", "4:3", "3:4", "3:2", "2:3"] },
  "wan-2.7-text-to-image": { name: "Wan 2.7", aspects: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"] },
  "wan-2.7-text-to-image-pro": { name: "Wan 2.7 Pro", aspects: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"] },
  "prefect-pony-xl": { name: "Prefect Pony XL", aspects: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"] },
  "1.0": { name: "Flux.1", aspects: [] },
  "1.1": { name: "Flux.1.1", aspects: [] },
  "1.2": { name: "Wan 2.6 (Flux tier)", aspects: [] },
  "2.0": { name: "Flux.2", aspects: [] },
  "flux-2-max": { name: "Flux 2 Max", aspects: [] },
  SDXL: { name: "SDXL uncensored", aspects: [] },
  realism: { name: "Realism", aspects: [] },
  "realism-2": { name: "Realism 2", aspects: [] },
  "z-image-turbo": { name: "Z Image Turbo", aspects: [] },
};

/**
 * Video catalog accepted as `model` on /image_to_video. Text-to-video posts an
 * empty `media_blob_name`; image-to-video posts the uploaded blob name.
 * `audio` models accept `audio_enabled`.
 */
const UC_VIDEO_MODELS = {
  default: { name: "Standard", t2v: true, i2v: true, aspects: ["auto", "16:9", "9:16", "1:1"], resolutions: ["480p", "720p"], seconds: [5, 8] },
  turbo: { name: "Turbo", t2v: true, i2v: true, aspects: ["auto", "16:9", "9:16", "1:1"], resolutions: ["480p", "720p"], seconds: [5, 8] },
  "wan-2.2-uncensored-v2": { name: "Wan Ultra Uncensored v2", t2v: true, i2v: true, aspects: ["auto", "16:9", "9:16", "1:1"], resolutions: ["480p", "720p"], seconds: [5, 8] },
  "wan-2.2-uncensored": { name: "Wan Ultra Uncensored", t2v: true, i2v: true, aspects: ["auto", "16:9", "9:16", "1:1"], resolutions: ["480p", "720p"], seconds: [5, 8] },
  "wan-2.6": { name: "Wan v2.6", t2v: true, i2v: true, aspects: ["auto", "16:9", "9:16", "1:1"], seconds: [5, 8] },
  "wan-2.6-ultra": { name: "Wan 2.6 Ultra Uncensored", t2v: true, i2v: true },
  "wan-2.7": { name: "Wan 2.7", t2v: true, i2v: true },
  "wan-2.7-pro": { name: "Wan 2.7 Pro", t2v: true, i2v: true },
  "wan-2.7-uncensored": { name: "Wan 2.7 Uncensored", t2v: true, i2v: true },
  "wan-2.7-uncensored-v2": { name: "Wan 2.7 Uncensored v2", t2v: true, i2v: true },
  "wan-3.0": { name: "Wan 3.0", t2v: true, i2v: true, audio: true },
  "wan-3.0-uncensored": { name: "Wan 3.0 Uncensored", t2v: true, i2v: true, audio: true },
  "wan-3.0-uncensored-pro": { name: "Wan 3.0 Uncensored Pro", t2v: true, i2v: true, audio: true },
  "sora-2": { name: "Sora 2", t2v: true, i2v: true, seconds: [4, 8, 12] },
  "sora-2-pro": { name: "Sora 2 Pro", t2v: true, i2v: true, seconds: [4, 8, 12] },
  "grok-imagine-video": { name: "Grok Imagine Video", t2v: true, i2v: true },
  "bytedance-seedance-2.0": { name: "Seedance 2.0", t2v: true, i2v: true },
  "seedance-2.0-fast": { name: "Seedance 2.0 Fast", t2v: true, i2v: true },
  "seedance-2.0-uncensored": { name: "Seedance 2.0 Uncensored", t2v: true, i2v: true, audio: true },
  "seedance-2.0-fast-uncensored": { name: "Seedance 2.0 Fast Uncensored", t2v: true, i2v: true, audio: true },
  "seedance-2.0-mini-uncensored": { name: "Seedance 2.0 Mini Uncensored", t2v: true, i2v: true, audio: true },
  "seedance-2.0-mini-turbo": { name: "Seedance 2.0 Mini Turbo Uncensored", t2v: true, i2v: true, audio: true },
  "seedance-v1.5-pro-uncensored": { name: "Seedance v1.5 Pro Uncensored", t2v: true, i2v: true, audio: true },
  "seedance-2.5-uncensored": { name: "Seedance 2.5 Uncensored", t2v: true, i2v: true, audio: true },
  "seedance-2.5": { name: "Seedance 2.5", t2v: true, i2v: true, audio: true },
  "vidu-q3-uncensored": { name: "Vidu Q3 Uncensored", t2v: true, i2v: true },
  "av-gen-v2": { name: "AV-Gen v2 with audio", t2v: true, i2v: true, audio: true },
  "cosmos-predict": { name: "Cosmos Predict 2.5", t2v: true, i2v: true },
  "minimax-h3": { name: "MiniMax H3", t2v: true, i2v: true },
  "happyhorse-1.0": { name: "Happy Horse 1.0", t2v: true, i2v: true },
  "wan/v2.2-a14b": { name: "Wan v2.2-a14b", t2v: true, i2v: true },
};

export function listUcImageModels() {
  return Object.entries(UC_IMAGE_MODELS).map(([id, spec]) => ({ id, ...spec }));
}

export function listUcVideoModels() {
  return Object.entries(UC_VIDEO_MODELS).map(([id, spec]) => ({ id, ...spec }));
}

function parseCookieJar(header) {
  const jar = new Map();
  for (const part of String(header || "").split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name) jar.set(name, part.slice(eq + 1).trim());
  }
  return jar;
}

function decodeJwt(token) {
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(b64 + "=".repeat((4 - (b64.length % 4)) % 4), "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function buildCookieHeader(jar) {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

/** Read a `Set-Cookie` value for `name` from a fetch response. */
function readSetCookie(res, name) {
  const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  for (const entry of list) {
    const pair = String(entry).split(";")[0];
    const eq = pair.indexOf("=");
    if (eq > 0 && pair.slice(0, eq).trim() === name) return pair.slice(eq + 1).trim();
  }
  return "";
}

/**
 * Resolve the Clerk session id. The legacy `__client` JWT carried `sid` as a
 * claim; current clients only expose `{id, rotating_token}`, so fall back to
 * listing the client's sessions.
 *
 * Clerk rotates `__client` on every `/v1/client` call; the new value must be
 * carried forward or the rotation chain drifts away from the stored cookie.
 */
async function resolveClerkSessionId(clientJwt, clerkHeaders, signal) {
  const legacySid = decodeJwt(clientJwt)?.sid;
  if (typeof legacySid === "string" && legacySid) return { sid: legacySid, rotatedClient: "" };

  const res = await fetch(`${UC_CLERK_FAPI}/v1/client?_clerk_js_version=${UC_CLERK_JS_VERSION}`, {
    headers: clerkHeaders,
    signal,
  });
  if (!res.ok) return { sid: "", rotatedClient: "" };
  const rotatedClient = readSetCookie(res, "__client");
  const body = await res.json().catch(() => null);
  const payload = body?.response ?? body?.client ?? body;
  const sessions = Array.isArray(payload?.sessions) ? payload.sessions : [];
  const active = sessions.find((s) => s?.status === "active") ?? sessions[0];
  return { sid: typeof active?.id === "string" ? active.id : "", rotatedClient };
}

/**
 * Mint the 60s Clerk `__session` JWT from the durable `__client` cookie.
 *
 * Newer Clerk clients ship a `__client` JWT whose only claims are
 * `{id, rotating_token}` — no `sid`. The session id must then be read from
 * `GET /v1/client`, which lists the client's sessions.
 *
 * Returns the rotated `__client` (if Clerk issued one) so the caller can
 * persist it back to the connection.
 */
async function mintSession(cookieHeader, signal) {
  const jar = parseCookieJar(cookieHeader);
  const client = jar.get("__client");
  if (!client) {
    throw Object.assign(new Error("UC credential missing the __client cookie — paste the full uncensored.com Cookie header from a logged-in session"), { status: 401 });
  }
  const clerkHeaders = {
    Cookie: buildCookieHeader(jar),
    Origin: UC_ORIGIN,
    Referer: `${UC_ORIGIN}/`,
    Accept: "application/json",
  };
  const resolved = await resolveClerkSessionId(client, clerkHeaders, signal);
  const sid = resolved.sid;
  if (!sid) {
    throw Object.assign(new Error("UC Clerk session not found — the __client cookie has no active session. Log in again via Login via Browser"), { status: 401 });
  }
  const res = await fetch(`${UC_CLERK_FAPI}/v1/client/sessions/${encodeURIComponent(sid)}/tokens?_clerk_js_version=${UC_CLERK_JS_VERSION}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: UC_ORIGIN,
      Referer: `${UC_ORIGIN}/`,
      Cookie: buildCookieHeader(jar),
    },
    body: "",
    signal,
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw Object.assign(new Error(`UC Clerk token mint failed (HTTP ${res.status}) ${detail}`), { status: res.status });
  }
  const rotatedClient = readSetCookie(res, "__client") || resolved.rotatedClient;
  const body = await res.json().catch(() => null);
  const jwt = body?.jwt;
  if (typeof jwt !== "string" || !jwt) {
    throw Object.assign(new Error("UC Clerk token mint returned no jwt"), { status: 502 });
  }
  const uid = decodeJwt(jwt)?.uid;
  return { jwt, uid: typeof uid === "string" ? uid : "", rotatedClient };
}

/** Swap the `__client` value inside a stored Cookie header. */
function withRotatedClient(cookieHeader, rotatedClient) {
  if (!rotatedClient) return "";
  const jar = parseCookieJar(cookieHeader);
  if (jar.get("__client") === rotatedClient) return "";
  jar.set("__client", rotatedClient);
  return buildCookieHeader(jar);
}

function authHeaders(jwt) {
  return {
    Authorization: `Bearer ${jwt}`,
    Origin: UC_ORIGIN,
    Referer: `${UC_ORIGIN}/`,
    "Content-Type": "application/json",
  };
}

function aspectFor(size, allowedAspects) {
  const raw = String(size || "").trim();
  const allowed = Array.isArray(allowedAspects) && allowedAspects.length ? allowedAspects : null;
  const pick = (candidate) => {
    if (!UC_ASPECT_SIZES[candidate]) return null;
    if (allowed && !allowed.includes(candidate)) return null;
    return { aspect_ratio: candidate, ...UC_ASPECT_SIZES[candidate] };
  };

  const direct = pick(raw);
  if (direct) return direct;
  if (raw.includes("x")) {
    const [w, h] = raw.split("x").map(Number);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      let best = null;
      let bestDelta = Infinity;
      for (const [aspect, dims] of Object.entries(UC_ASPECT_SIZES)) {
        if (allowed && !allowed.includes(aspect)) continue;
        const delta = Math.abs(Number(dims.imageWidth) / Number(dims.imageHeight) - w / h);
        if (delta < bestDelta) { bestDelta = delta; best = aspect; }
      }
      if (best) return { aspect_ratio: best, ...UC_ASPECT_SIZES[best] };
    }
  }
  const fallback = allowed?.[0] || "1:1";
  return { aspect_ratio: fallback, ...UC_ASPECT_SIZES[fallback] };
}

/** HEAD-poll the pre-determined result URL until it serves 200. */
async function pollResultUrl(url, { signal, log, intervalMs = POLL_INTERVAL_MS, timeoutMs = POLL_TIMEOUT_MS }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("aborted");
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    let status = 0;
    try {
      const res = await fetch(url, { method: "HEAD", headers: { Referer: `${UC_ORIGIN}/` }, signal });
      status = res.status;
    } catch {
      status = 0; // transient network — keep polling
    }
    if (status === 200) return;
    if (status >= 400 && status < 500 && status !== 429) {
      log?.warn?.("UC-WEB", `result poll got HTTP ${status} — continuing until timeout`);
    }
  }
  throw new Error("UC result did not become available in time");
}

async function downloadBinary(url, { signal }) {
  const res = await fetch(url, { headers: { Referer: `${UC_ORIGIN}/` }, signal });
  if (!res.ok) throw new Error(`UC result download failed (HTTP ${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  return { b64: buffer.toString("base64"), mime: (res.headers.get("content-type") || "").split(";")[0] || "application/octet-stream" };
}

async function resolveImageBytes(ref, signal, log) {
  const dataMatch = /^data:[^;]*;base64,(.*)$/.exec(String(ref));
  if (dataMatch) return Buffer.from(dataMatch[1], "base64");
  if (/^https?:\/\//i.test(String(ref))) {
    const res = await fetch(ref, { signal, headers: { Accept: "image/*", "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36" } });
    if (!res.ok) throw new Error(`input image download failed (HTTP ${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
  try {
    return Buffer.from(String(ref), "base64");
  } catch {
    log?.error?.("UC-WEB", "could not decode input image");
    return null;
  }
}

export class UcWebExecutor extends BaseExecutor {
  constructor() {
    super("uc-web", { id: "uc-web", baseUrl: "https://internal.chatuncensored.ai" });
  }

  async execute() {
    return {
      response: new Response(JSON.stringify({
        error: { message: "uc-web is a media provider — use /v1/images/generations or /v1/videos/generations", type: "invalid_request" },
      }), { status: 400, headers: { "Content-Type": "application/json" } }),
      url: UC_IMAGE_URL, headers: {}, transformedBody: {},
    };
  }

  /**
   * kind "image": /v2/image-gen — `model` is a `model_version` from UC_IMAGE_MODELS.
   * kind "video": /image_to_video — `model` from UC_VIDEO_MODELS; an input image
   * is uploaded first and passed as `media_blob_name`.
   */
  async generateMedia({ prompt, kind = "image", size, model, duration, resolution, images, credentials, signal, log }) {
    if (kind !== "image" && kind !== "video") throw new Error("uc-web supports image and video generation only");
    if (!prompt?.trim()) throw new Error("prompt is required");

    const cookieHeader = String(credentials?.apiKey || "");
    const { jwt, uid, rotatedClient } = await mintSession(cookieHeader, signal);
    // Clerk rotates `__client` per call; hand the new value back so the caller
    // can persist it to the connection instead of letting the chain drift.
    const nextCookieHeader = withRotatedClient(cookieHeader, rotatedClient);
    if (nextCookieHeader && credentials) credentials.apiKey = nextCookieHeader;
    const headers = authHeaders(jwt);

    if (kind === "image") {
      const imageModel = model || UC_DEFAULT_IMAGE_MODEL;
      if (!UC_IMAGE_MODELS[imageModel]) {
        throw Object.assign(new Error(`Unknown UC image model "${imageModel}" — see the provider's model list`), { status: 400 });
      }
      const spec = UC_IMAGE_MODELS[imageModel];
      const body = {
        prompt,
        mode: UC_IMAGE_MODE,
        model_version: spec.upstream || imageModel,
        m_n_user: true,
        moderationMode: UC_MODERATION_MODE,
        country: UC_COUNTRY,
        vdiscount: false,
        ...aspectFor(size, spec.aspects),
      };
      if (spec.resolutions?.length) {
        const want = String(resolution || "").toLowerCase();
        body.resolution = spec.resolutions.includes(want) ? want : spec.resolutions[0];
      }
      const res = await fetch(UC_IMAGE_URL, { method: "POST", headers, body: JSON.stringify(body), signal });
      if (!res.ok) {
        const detail = (await res.text().catch(() => "")).slice(0, 200);
        throw Object.assign(new Error(`UC image request failed (HTTP ${res.status}) ${detail}`), { status: res.status });
      }
      const json = await res.json().catch(() => null);
      const resultUrl = typeof json?.url === "string" ? json.url : "";
      if (!resultUrl) throw new Error("UC image response carried no result url");
      await pollResultUrl(resultUrl, { signal, log });
      return [await downloadBinary(resultUrl, { signal })];
    }

    const videoModel = model || UC_DEFAULT_VIDEO_MODEL;
    if (!UC_VIDEO_MODELS[videoModel]) {
      throw Object.assign(new Error(`Unknown UC video model "${videoModel}" — see the provider's model list`), { status: 400 });
    }
    const spec = UC_VIDEO_MODELS[videoModel];
    const inputImage = Array.isArray(images) ? images[0] : images;
    if (inputImage && spec.i2v === false) throw new Error(`UC video model "${videoModel}" does not accept an input image`);
    if (!inputImage && spec.t2v === false) throw new Error(`UC video model "${videoModel}" requires an input image`);

    const seconds = Number(duration) > 0 ? Number(duration) : (spec.seconds?.[0] ?? 5);
    const videoResolution = spec.resolutions?.length
      ? (spec.resolutions.includes(String(resolution || "")) ? String(resolution) : spec.resolutions[0])
      : "480p";
    const videoBody = {
      prompt,
      media_blob_name: null,
      num_frames: Math.round(seconds * 16) + 1,
      frames_per_second: 16,
      num_inference_steps: 30,
      guide_scale: 5,
      shift: 5,
      aspect_ratio: spec.aspects?.includes("auto") ? "auto" : "9:16",
      pro_mode: videoModel === "wan-3.0-uncensored-pro",
      turbo: videoModel === "turbo",
      resolution: videoResolution,
      sora_resolution: videoResolution,
      end_frame_blob_name: null,
      model: videoModel,
      seconds,
      video_to_video_duration: seconds,
      vdiscount: false,
    };

    if (inputImage) {
      // Image-to-video: signed URL → PUT bytes → generate with blob name.
      if (!uid) throw Object.assign(new Error("Could not derive the account uid — re-paste the full Cookie header"), { status: 401 });
      const bytes = await resolveImageBytes(inputImage, signal, log);
      if (!bytes) throw new Error("UC image-to-video could not decode the input image");
      const signedRes = await fetch(UC_SIGNED_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({ content_type: "image/png", user_identifier: uid }),
        signal,
      });
      if (!signedRes.ok) {
        const detail = (await signedRes.text().catch(() => "")).slice(0, 200);
        throw Object.assign(new Error(`UC signed-url request failed (HTTP ${signedRes.status}) ${detail}`), { status: signedRes.status });
      }
      const signed = await signedRes.json().catch(() => null);
      if (!signed?.signed_url || !signed?.blob_name) throw new Error("UC signed-url response missing signed_url or blob_name");
      const putRes = await fetch(signed.signed_url, {
        method: "PUT",
        headers: { "Content-Type": "image/png" },
        body: new Uint8Array(bytes),
        signal,
      });
      if (!putRes.ok) throw Object.assign(new Error(`UC input-image upload failed (HTTP ${putRes.status})`), { status: putRes.status });
      videoBody.media_blob_name = signed.blob_name;
    }

    const genRes = await fetch(UC_VIDEO_URL, { method: "POST", headers, body: JSON.stringify(videoBody), signal });
    if (!genRes.ok) {
      const detail = (await genRes.text().catch(() => "")).slice(0, 200);
      throw Object.assign(new Error(`UC video request failed (HTTP ${genRes.status}) ${detail}`), { status: genRes.status });
    }
    const genJson = await genRes.json().catch(() => null);
    const resultUrl = typeof genJson?.url === "string" ? genJson.url : "";
    if (!resultUrl) throw new Error("UC video response carried no result url");
    const timeoutMs = Number.isFinite(Number(genJson?.timeout_seconds)) && Number(genJson.timeout_seconds) > 0
      ? Number(genJson.timeout_seconds) * 1000
      : POLL_TIMEOUT_MS;
    await pollResultUrl(resultUrl, { signal, log, timeoutMs });
    return [await downloadBinary(resultUrl, { signal })];
  }
}

export default UcWebExecutor;
