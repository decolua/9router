import { pollinationsHeaders } from "../../services/pollinationsModels.js";

const BASE = "https://gen.pollinations.ai";
const JOB_ID = /^[0-9a-f]{64}$/;

function storedUrl(response) {
  const link = response.headers.get("link") || "";
  const match = link.match(/<([^>]+)>\s*;\s*rel="?enclosure"?/i);
  if (!match) throw new Error("Pollinations video response is missing its stored-file Link header");
  const url = new URL(match[1]);
  if (url.origin !== "https://media.pollinations.ai" || url.username || url.password) throw new Error("Invalid Pollinations stored video URL");
  return url.href;
}

function completed(url, id) {
  const video = { url, mime_type: "video/mp4" };
  return { ...(id ? { id, request_id: id } : {}), status: "completed", video, videos: [video] };
}

export default {
  buildRequest({ action, requestId, rawBody, contentType, credentials, token }) {
    const auth = pollinationsHeaders(credentials || { apiKey: token });
    const headers = { Accept: "application/json, video/mp4", ...auth };
    if (requestId) {
      if (!JOB_ID.test(requestId)) return { error: "Invalid Pollinations video job id" };
      return { method: "GET", url: `${BASE}/v1/jobs/${requestId}`, headers };
    }
    if (action !== "generations") return { error: "Pollinations has no documented video edits or extensions endpoint; use generations with supported frame/reference inputs" };
    if (contentType && !contentType.includes("application/json")) return { error: "Pollinations video requires an application/json body" };
    let body;
    try { body = JSON.parse(typeof rawBody === "string" ? rawBody : rawBody.toString("utf8")); }
    catch { return { error: "Invalid JSON body" }; }
    if (!body || typeof body.model !== "string" || typeof body.prompt !== "string" || !body.prompt.trim() || [".", ".."].includes(body.prompt.trim())) return { error: "Pollinations video requires a model and non-empty prompt" };
    if (body.video != null || body.video_url != null || body.video_id != null) return { error: "Pollinations supports reference_videos guidance, not video edits/extensions" };
    const url = new URL(`${BASE}/video/${encodeURIComponent(body.prompt)}`);
    url.searchParams.set("model", body.model);
    for (const field of ["duration", "width", "height", "seed", "resolution", "safe", "audio"]) {
      if (body[field] != null) url.searchParams.set(field, String(body[field]));
    }
    if (body.seconds != null && body.duration == null) url.searchParams.set("duration", String(body.seconds));
    if (body.aspectRatio != null || body.aspect_ratio != null) url.searchParams.set("aspectRatio", String(body.aspectRatio ?? body.aspect_ratio));
    if (body.generate_audio != null && body.audio == null) url.searchParams.set("audio", String(body.generate_audio));
    for (const [field, value] of Object.entries({ image: body.image ?? body.image_url, reference_images: body.reference_images, reference_videos: body.reference_videos, reference_audios: body.reference_audios })) {
      if (value == null) continue;
      const refs = Array.isArray(value) ? value : [value];
      if (!refs.length || refs.some((ref) => typeof ref !== "string" || !/^https?:\/\//i.test(ref) || ref.includes("|"))) return { error: `${field} must contain public HTTP(S) URLs without a | separator` };
      url.searchParams.set(field, refs.join("|"));
    }
    return { method: "GET", url: url.href, headers: { ...headers, Prefer: "respond-async" } };
  },

  async parseResponse(response, { credentials, signal } = {}) {
    if ((response.headers.get("content-type") || "").startsWith("video/")) {
      const url = storedUrl(response);
      await response.body?.cancel();
      return completed(url);
    }
    const job = await response.json();
    if (!JOB_ID.test(job?.id || "")) throw new Error("Invalid Pollinations video job response");
    if (job.status === "failed") return { ...job, request_id: job.id };
    if (job.status === "succeeded") {
      // Fetch only the fixed authenticated result endpoint, never an upstream-provided URL.
      const result = await fetch(`${BASE}/v1/jobs/${job.id}/result`, { headers: pollinationsHeaders(credentials), signal });
      if (!result.ok) throw new Error(`Pollinations video result failed (${result.status})`);
      const url = storedUrl(result);
      await result.body?.cancel();
      return completed(url, job.id);
    }
    if (!["pending", "queued", "processing"].includes(job.status)) throw new Error("Invalid Pollinations video job status");
    return { ...job, request_id: job.id, status: job.status === "processing" ? "in_progress" : "pending" };
  },
};
