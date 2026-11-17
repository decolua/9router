/**
 * Qoder image generation via the Cloud Agents API (open-sse/handlers/imageProviders/qoder.js).
 * global.fetch is replaced by a small fake of the Cloud Agents endpoints.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";
import qoderImage, { resolveQoderImageSize } from "../../open-sse/handlers/imageProviders/qoder.js";
import { forgetImageSetup } from "../../open-sse/shared/qoder/cloudAgents.js";
import { QODER_CLOUD_API_BASE } from "../../open-sse/shared/qoder/constants.js";

const originalFetch = global.fetch;
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const PNG_DATA_URI = `data:image/png;base64,${PNG_BYTES.toString("base64")}`;

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Fake Cloud Agents API. `turn(sessionId, text)` returns the events of one turn. */
function fakeCloud({ turn } = {}) {
  const calls = [];
  const state = { sessions: 0, files: 0, messages: {}, mounts: [], archived: [], deleted: [] };
  const defaultTurn = (sid) => [
    { id: `${sid}_1`, type: "user.message" },
    { id: `${sid}_2`, type: "session.status_running" },
    { id: `${sid}_3`, type: "agent.tool_use", name: "ImageGen" },
    { id: `${sid}_4`, type: "agent.tool_result", is_error: false, content: [{ type: "text", text: "ok" }] },
    { id: `${sid}_5`, type: "agent.artifact_delivered", file_id: `out_${sid}`, original_filename: "img.png", content_type: "image/png" },
    { id: `${sid}_6`, type: "session.status_idle", stop_reason: { type: "end_turn" } },
  ];
  global.fetch = vi.fn(async (url, opts = {}) => {
    const u = new URL(String(url));
    const method = opts.method || "GET";
    calls.push({ method, path: u.pathname + u.search, headers: opts.headers || {}, body: opts.body });
    if (u.hostname === "files.example.com") return new Response(PNG_BYTES, { status: 200 });
    const path = u.pathname.replace(new URL(QODER_CLOUD_API_BASE).pathname, "");
    const body = typeof opts.body === "string" ? JSON.parse(opts.body) : null;

    if (method === "GET" && (path === "/environments" || path === "/agents")) return json(200, { data: [], has_more: false });
    if (method === "POST" && path === "/environments") return json(200, { id: "env_1", name: body.name });
    if (method === "POST" && path === "/agents") return json(200, { id: "agent_1", name: body.name });
    if (method === "POST" && path === "/sessions") return json(200, { id: `sess_${++state.sessions}`, status: "idle" });
    if (method === "POST" && path === "/files") return json(200, { id: `in_${++state.files}` });
    let m;
    if ((m = path.match(/^\/sessions\/([^/]+)\/resources$/)) && method === "POST") {
      state.mounts.push({ session: m[1], ...body });
      return json(200, { id: "sesr_1" });
    }
    if ((m = path.match(/^\/sessions\/([^/]+)\/events$/))) {
      if (method === "POST") {
        state.messages[m[1]] = body.events[0].content[0].text;
        return json(200, {});
      }
      const events = (turn || defaultTurn)(m[1], state.messages[m[1]]);
      const after = u.searchParams.get("after_id");
      const start = after ? events.findIndex((e) => e.id === after) + 1 : 0;
      return json(200, { data: events.slice(start), has_more: false });
    }
    if ((m = path.match(/^\/sessions\/([^/]+)\/archive$/))) {
      state.archived.push(m[1]);
      return json(200, { id: m[1], status: "terminated" });
    }
    if ((m = path.match(/^\/files\/([^/]+)\/content$/))) return json(200, { url: `https://files.example.com/${m[1]}.png` });
    if ((m = path.match(/^\/files\/([^/]+)$/)) && method === "DELETE") {
      state.deleted.push(m[1]);
      return json(200, { id: m[1], type: "file_deleted" });
    }
    return json(404, { type: "error", error: { type: "not_found_error", message: `no route ${method} ${path}` } });
  });
  return { calls, state };
}

function generate(body, credentials = { apiKey: "pt-test-token" }) {
  return handleImageGenerationCore({
    body: { model: "qd/imagegen", ...body },
    modelInfo: { provider: "qoder", model: "imagegen" },
    credentials,
    log: null,
  });
}

describe("resolveQoderImageSize", () => {
  it("keeps supported sizes and maps everything else to the closest ImageGen size", () => {
    expect(resolveQoderImageSize({})).toBe("1024x1024");
    expect(resolveQoderImageSize({ size: "1792x1024" })).toBe("1792x1024");
    expect(resolveQoderImageSize({ size: "1920x1080" })).toBe("1792x1024");
    expect(resolveQoderImageSize({ size: "512x512" })).toBe("1024x1024");
    expect(resolveQoderImageSize({ size: "auto" })).toBe("1024x1024");
    expect(resolveQoderImageSize({ aspect_ratio: "3:4" })).toBe("768x1024");
    expect(resolveQoderImageSize({ aspect_ratio: "9:16", size: "1024x1024" })).toBe("1024x1792");
    expect(resolveQoderImageSize({ aspect_ratio: "21:9" })).toBe("2560x1080");
  });
});

describe("Qoder image adapter", () => {
  beforeEach(() => {
    forgetImageSetup("pt-test-token");
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("only uses PAT connections", () => {
    expect(qoderImage.canUseCredentials({ apiKey: "pt-abc" })).toBe(true);
    expect(qoderImage.canUseCredentials({ accessToken: "pt-abc" })).toBe(true);
    expect(qoderImage.canUseCredentials({ accessToken: "oauth-token" })).toBe(false);
    expect(qoderImage.canUseCredentials({ accessToken: "jt-job-token" })).toBe(false);
  });

  it("generates an image through an agent session and archives it", async () => {
    const { calls, state } = fakeCloud();
    const result = await generate({ prompt: "an orange cat on a laptop, 16:9", size: "1792x1024" });

    expect(result.success).toBe(true);
    const out = await result.response.json();
    expect(out.data).toEqual([{ url: "https://files.example.com/out_sess_1.png" }]);
    expect(typeof out.created).toBe("number");

    // PAT is sent as Bearer to the Cloud Agents API
    const cloudCalls = calls.filter((c) => c.path.startsWith("/api/v1/cloud"));
    expect(cloudCalls.every((c) => c.headers.Authorization === "Bearer pt-test-token")).toBe(true);
    // agent gets the ImageGen toolset
    const agentCall = calls.find((c) => c.method === "POST" && c.path.endsWith("/agents"));
    expect(JSON.parse(agentCall.body).tools[0].enabled_tools).toContain("ImageGen");
    // the instruction carries the size and the prompt verbatim
    expect(state.messages.sess_1).toContain("- size: 1792x1024");
    expect(state.messages.sess_1).toContain("an orange cat on a laptop, 16:9");
    expect(state.archived).toEqual(["sess_1"]);
  });

  it("reuses the environment and agent for later requests", async () => {
    const { calls } = fakeCloud();
    await generate({ prompt: "one" });
    await generate({ prompt: "two" });
    expect(calls.filter((c) => c.method === "POST" && c.path.endsWith("/agents"))).toHaveLength(1);
    expect(calls.filter((c) => c.method === "POST" && c.path.endsWith("/environments"))).toHaveLength(1);
    expect(calls.filter((c) => c.method === "POST" && c.path.endsWith("/sessions"))).toHaveLength(2);
  });

  it("runs one session per image for n > 1 and returns b64_json on request", async () => {
    const { state } = fakeCloud();
    const result = await generate({ prompt: "two cats", n: 2, response_format: "b64_json" });
    const out = await result.response.json();
    expect(out.data).toHaveLength(2);
    expect(out.data[0].b64_json).toBe(PNG_BYTES.toString("base64"));
    expect(state.archived).toEqual(["sess_1", "sess_2"]);
  });

  it("uploads, mounts and cleans up input images for edits", async () => {
    const { state } = fakeCloud();
    const result = await generate({ prompt: "make the cat black", image: PNG_DATA_URI });
    expect(result.success).toBe(true);
    expect(state.mounts).toEqual([{ session: "sess_1", type: "file", file_id: "in_1", mount_path: "/data/inputs/input-1.png" }]);
    expect(state.messages.sess_1).toContain('- images: ["/data/inputs/input-1.png"]');
    expect(state.deleted).toEqual(["in_1"]);
  });

  it("rejects more than three input images", async () => {
    fakeCloud();
    const result = await generate({ prompt: "x", images: [PNG_DATA_URI, PNG_DATA_URI, PNG_DATA_URI, PNG_DATA_URI] });
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toContain("at most 3");
  });

  it("refuses non-PAT credentials without calling Qoder", async () => {
    const { calls } = fakeCloud();
    const result = await generate({ prompt: "x" }, { accessToken: "oauth-token" });
    expect(result.success).toBe(false);
    expect(result.status).toBe(403);
    expect(result.error).toContain("Personal Access Token");
    expect(calls).toHaveLength(0);
  });

  it("maps a throttled ImageGen call to 429 and still archives the session", async () => {
    const { state } = fakeCloud({
      turn: (sid) => [
        { id: `${sid}_1`, type: "session.status_running" },
        { id: `${sid}_2`, type: "agent.tool_result", is_error: true, content: [{ type: "text", text: "Throttling.QueueQuota: too many requests" }] },
        { id: `${sid}_3`, type: "session.status_idle", stop_reason: { type: "end_turn" } },
      ],
    });
    const result = await generate({ prompt: "x" });
    expect(result.success).toBe(false);
    expect(result.status).toBe(429);
    expect(result.error).toContain("QueueQuota");
    expect(state.archived).toEqual(["sess_1"]);
  });

  it("fails clearly when the agent ends without an image", async () => {
    fakeCloud({
      turn: (sid) => [
        { id: `${sid}_1`, type: "session.status_running" },
        { id: `${sid}_2`, type: "agent.message", content: [{ type: "text", text: "I cannot do that." }] },
        { id: `${sid}_3`, type: "session.status_idle", stop_reason: { type: "end_turn" } },
      ],
    });
    const result = await generate({ prompt: "x" });
    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.error).toContain("without delivering an image");
  });
});
