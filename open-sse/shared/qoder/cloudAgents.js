/**
 * Minimal client for the Qoder Cloud Agents API, used for image generation.
 *
 * Unlike the COSY chat path, Cloud Agents speak plain JSON over
 * https://api.qoder.com/api/v1/cloud and accept the raw PAT (pt-...) as a
 * Bearer token. A generation is one agent turn:
 *   environment + agent (created once, cached per PAT)
 *   → session → [upload + mount input images] → user.message
 *   → poll events until agent.artifact_delivered + idle
 *   → GET /files/{id}/content (presigned URL) → archive session.
 */
import { createHash } from "node:crypto";
import { QODER_CLOUD_API_BASE, QODER_IMAGE_CONFIG, QODER_PAT_PREFIX } from "./constants.js";

// Next.js polyfills globalThis.FormData with an implementation the patched (undici)
// fetch cannot serialize ("[object FormData]"), so prefer undici's FormData — same as sttCore.
let FormDataImpl = globalThis.FormData;
try {
  const undici = await import("undici");
  if (undici?.FormData) FormDataImpl = undici.FormData;
} catch {
  // lightweight harnesses without undici keep the global FormData
}

export class QoderCloudError extends Error {
  constructor(status, message, code = null) {
    super(message);
    this.name = "QoderCloudError";
    this.status = status;
    this.code = code;
  }
}

/** The raw PAT of a connection, or null (OAuth / job-token connections cannot use Cloud Agents). */
export function qoderPatOf(credentials) {
  for (const value of [credentials?.apiKey, credentials?.accessToken]) {
    if (typeof value === "string" && value.startsWith(QODER_PAT_PREFIX)) return value;
  }
  return null;
}

async function request(pat, method, path, { json, form } = {}) {
  const headers = { Authorization: `Bearer ${pat}`, Accept: "application/json" };
  let body;
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  } else if (form) {
    body = form;
  }
  const res = await fetch(`${QODER_CLOUD_API_BASE}${path}`, { method, headers, body });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const err = data?.error || {};
    const message = err.message || data?.message || text.slice(0, 300) || `HTTP ${res.status}`;
    throw new QoderCloudError(res.status, `Qoder Cloud Agents: ${message}`, err.type || data?.code || null);
  }
  return data;
}

// environment + agent ids per PAT (hashed so the token never becomes a map key)
const setupCache = new Map();

function patKey(pat) {
  return createHash("sha256").update(pat).digest("hex");
}

async function findByName(pat, path, name) {
  const page = await request(pat, "GET", `${path}?limit=100`);
  return (page?.data || []).find((item) => item?.name === name && !item?.archived_at) || null;
}

async function setup(pat) {
  const cfg = QODER_IMAGE_CONFIG;
  const env = (await findByName(pat, "/environments", cfg.environmentName))
    || (await request(pat, "POST", "/environments", { json: { name: cfg.environmentName } }));
  const agent = (await findByName(pat, "/agents", cfg.agentName))
    || (await request(pat, "POST", "/agents", {
      json: {
        name: cfg.agentName,
        model: cfg.agentModel,
        system: cfg.agentSystem,
        tools: [{ type: "agent_toolset_20260401", enabled_tools: [...cfg.agentTools] }],
      },
    }));
  if (!env?.id || !agent?.id) throw new QoderCloudError(502, "Qoder Cloud Agents: could not prepare environment/agent");
  return { environmentId: env.id, agentId: agent.id };
}

/** Environment + agent for this PAT, created on first use and reused afterwards. */
export function ensureImageSetup(pat) {
  const key = patKey(pat);
  if (!setupCache.has(key)) {
    const pending = setup(pat).catch((error) => {
      setupCache.delete(key);
      throw error;
    });
    setupCache.set(key, pending);
  }
  return setupCache.get(key);
}

/** Drop the cached setup (e.g. the agent was archived upstream). */
export function forgetImageSetup(pat) {
  setupCache.delete(patKey(pat));
}

export function createSession(pat, { agentId, environmentId, title }) {
  return request(pat, "POST", "/sessions", {
    json: { agent: agentId, environment_id: environmentId, title },
  });
}

export async function uploadFile(pat, { bytes, filename, mimeType }) {
  const form = new FormDataImpl();
  form.append("file", new Blob([bytes], { type: mimeType }), filename);
  return request(pat, "POST", "/files", { form });
}

export function mountFile(pat, sessionId, fileId, mountPath) {
  return request(pat, "POST", `/sessions/${sessionId}/resources`, {
    json: { type: "file", file_id: fileId, mount_path: mountPath },
  });
}

export function sendUserMessage(pat, sessionId, text) {
  return request(pat, "POST", `/sessions/${sessionId}/events`, {
    json: { events: [{ type: "user.message", content: [{ type: "text", text }] }] },
  });
}

export async function fileContentUrl(pat, fileId) {
  const data = await request(pat, "GET", `/files/${fileId}/content`);
  if (!data?.url) throw new QoderCloudError(502, "Qoder Cloud Agents: file has no download URL");
  return data.url;
}

/** Best-effort cleanup: archived sessions release their mounts and stop counting as active. */
export async function archiveSession(pat, sessionId) {
  try { await request(pat, "POST", `/sessions/${sessionId}/archive`, { json: {} }); } catch { /* ignore */ }
}

export async function deleteFile(pat, fileId) {
  try { await request(pat, "DELETE", `/files/${fileId}`); } catch { /* ignore */ }
}

const QUEUE_FULL = /throttl|queuequota|queue.*(full|quota)|too many/i;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll the session's events until the turn ends. Resolves with the delivered
 * files and the session's credit usage, or throws with the tool/session error.
 */
export async function waitForArtifacts(pat, sessionId, { pollIntervalMs, timeoutMs } = {}) {
  const interval = pollIntervalMs ?? QODER_IMAGE_CONFIG.pollIntervalMs;
  const deadline = Date.now() + (timeoutMs ?? QODER_IMAGE_CONFIG.timeoutMs);
  const artifacts = [];
  let credits = null;
  let toolError = null;
  let started = false;
  let afterId = null;

  while (Date.now() < deadline) {
    const query = new URLSearchParams({ limit: "100" });
    if (afterId) query.set("after_id", afterId);
    const page = await request(pat, "GET", `/sessions/${sessionId}/events?${query}`);
    for (const event of page?.data || []) {
      afterId = event.id || afterId;
      switch (event.type) {
        case "session.status_running":
        case "session.thread_status_running":
          started = true;
          break;
        case "agent.artifact_delivered":
          started = true;
          artifacts.push({ fileId: event.file_id, filename: event.original_filename, contentType: event.content_type });
          break;
        case "agent.tool_result":
          if (event.is_error) {
            toolError = (event.content || []).map((c) => c?.text || "").join(" ").trim() || "ImageGen failed";
          }
          break;
        case "session.usage":
          // cumulative for the session; the session only ever runs this one turn
          credits = Number(event.total_credits);
          if (!Number.isFinite(credits)) credits = null;
          break;
        case "session.error": {
          const message = event.error?.message || "session error";
          throw new QoderCloudError(QUEUE_FULL.test(message) ? 429 : 502, `Qoder Cloud Agents: ${message}`, event.error?.type || null);
        }
        case "session.status_idle":
        case "session.status_terminated":
          if (!started) break;
          if (artifacts.length) return { artifacts, credits };
          if (toolError) throw new QoderCloudError(QUEUE_FULL.test(toolError) ? 429 : 502, `Qoder ImageGen: ${toolError.slice(0, 500)}`);
          throw new QoderCloudError(502, "Qoder ImageGen: the agent finished without delivering an image");
        default:
          break;
      }
    }
    if (!page?.has_more) await sleep(interval);
  }
  throw new QoderCloudError(504, "Qoder ImageGen: timed out waiting for the image");
}
