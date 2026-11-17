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
function fakeCloud({ turn, sessionFailures = [], contentStatus = 200, environmentPages = null } = {}) {
  const calls = [];
  const state = { sessions: 0, files: 0, messages: {}, mounts: [], archived: [], deleted: [], sessionAttempts: 0 };
  const defaultTurn = (sid) => [
    { id: `${sid}_1`, type: "user.message" },
    { id: `${sid}_2`, type: "session.status_running" },
    { id: `${sid}_3`, type: "agent.tool_use", name: "ImageGen" },
    { id: `${sid}_4`, type: "agent.tool_result", is_error: false, content: [{ type: "text", text: "ok" }] },
    { id: `${sid}_5`, type: "agent.artifact_delivered", file_id: `out_${sid}`, original_filename: "img.png", content_type: "image/png" },
    { id: `${sid}_6`, type: "session.usage", model_credits: 0.07, sandbox_runtime_credits: 0, total_credits: 0.07 },
    { id: `${sid}_7`, type: "session.status_idle", stop_reason: { type: "end_turn" } },
  ];
  global.fetch = vi.fn(async (url, opts = {}) => {
    const u = new URL(String(url));
    const method = opts.method || "GET";
    calls.push({ method, path: u.pathname + u.search, headers: opts.headers || {}, body: opts.body });
    if (u.hostname === "files.example.com") return new Response(PNG_BYTES, { status: 200 });
    const path = u.pathname.replace(new URL(QODER_CLOUD_API_BASE).pathname, "");
    const body = typeof opts.body === "string" ? JSON.parse(opts.body) : null;

    if (method === "GET" && path === "/environments" && environmentPages) {
      const after = u.searchParams.get("after_id");
      const index = after ? environmentPages.findIndex((p) => p.at(-1).id === after) + 1 : 0;
      const page = environmentPages[index];
      return json(200, { data: page, has_more: index < environmentPages.length - 1, last_id: page.at(-1).id });
    }
    if (method === "GET" && (path === "/environments" || path === "/agents")) return json(200, { data: [], has_more: false });
    if (method === "POST" && path === "/environments") return json(200, { id: "env_1", name: body.name });
    if (method === "POST" && path === "/agents") return json(200, { id: "agent_1", name: body.name });
    if (method === "POST" && path === "/sessions") {
      const failure = sessionFailures[state.sessionAttempts++];
      if (failure) return json(failure, { type: "error", error: { type: "not_found_error", message: "agent not found" } });
      return json(200, { id: `sess_${++state.sessions}`, status: "idle" });
    }
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
    if ((m = path.match(/^\/files\/([^/]+)\/content$/))) {
      if (contentStatus !== 200) return json(contentStatus, { type: "error", error: { type: "not_found_error", message: "file not found" } });
      return json(200, { url: `https://files.example.com/${m[1]}.png` });
    }
    if ((m = path.match(/^\/files\/([^/]+)$/)) && method === "DELETE") {
      state.deleted.push(m[1]);
      return json(200, { id: m[1], type: "file_deleted" });
    }
    return json(404, { type: "error", error: { type: "not_found_error", message: `no route ${method} ${path}` } });
  });
  return { calls, state };
}

function generate(body, credentials = { apiKey: "pt-test-token" }, extra = {}) {
  return handleImageGenerationCore({
    body: { model: "qd/imagegen", ...body },
    modelInfo: { provider: "qoder", model: "imagegen" },
    credentials,
    log: null,
    ...extra,
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

  it("reports one usage record per request with the summed Qoder credits", async () => {
    fakeCloud();
    const onUsage = vi.fn();
    const result = await generate({ prompt: "two cats", n: 2 }, undefined, { onUsage });
    expect(result.success).toBe(true);
    expect(onUsage).toHaveBeenCalledTimes(1);
    expect(onUsage).toHaveBeenCalledWith({ prompt_tokens: 0, completion_tokens: 0, qoder_credits: 0.14 });
  });

  it("does not report usage when generation fails", async () => {
    fakeCloud({
      turn: (sid) => [
        { id: `${sid}_1`, type: "session.status_running" },
        { id: `${sid}_2`, type: "session.status_idle", stop_reason: { type: "end_turn" } },
      ],
    });
    const onUsage = vi.fn();
    const result = await generate({ prompt: "x" }, undefined, { onUsage });
    expect(result.success).toBe(false);
    expect(onUsage).not.toHaveBeenCalled();
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

  it("rejects invalid input before calling Qoder", async () => {
    const { calls } = fakeCloud();
    const cases = [
      [{ prompt: "x", n: 5 }, /n must be an integer between 1 and 4/],
      [{ prompt: "x", n: 1.5 }, /n must be an integer/],
      [{ prompt: { text: "x" } }, /prompt must be a non-empty string/],
      [{ prompt: "x".repeat(4001) }, /at most 4000 characters/],
      [{ prompt: "x", image: `data:image/png;base64,${Buffer.from("not an image at all").toString("base64")}` }, /PNG, JPEG or WebP/],
      [{ prompt: "x", image: `data:image/png;base64,${Buffer.concat([PNG_BYTES, Buffer.alloc(5 * 1024 * 1024)]).toString("base64")}` }, /at most 5 MB/],
    ];
    for (const [body, message] of cases) {
      const result = await generate(body);
      expect(result.status, JSON.stringify(body).slice(0, 60)).toBe(400);
      expect(result.error).toMatch(message);
    }
    expect(calls).toHaveLength(0);
  });

  it("detects the real image type instead of trusting the declared one", async () => {
    const { calls } = fakeCloud();
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    const result = await generate({ prompt: "x", image: `data:image/png;base64,${jpeg.toString("base64")}` });
    expect(result.success).toBe(true);
    const upload = calls.find((c) => c.method === "POST" && c.path.endsWith("/files"));
    expect(upload.body.get("file").type).toBe("image/jpeg");
    expect(upload.body.get("file").name).toBe("input-1.jpg");
  });

  it("rebuilds the cached setup once when the agent was archived upstream", async () => {
    const { calls, state } = fakeCloud({ sessionFailures: [404] });
    const result = await generate({ prompt: "x" });
    expect(result.success).toBe(true);
    expect(calls.filter((c) => c.method === "POST" && c.path.endsWith("/agents"))).toHaveLength(2);
    expect(state.sessions).toBe(1);
  });

  it("does not regenerate (and bill again) when a later step returns 404", async () => {
    const { state } = fakeCloud({ contentStatus: 404 });
    const result = await generate({ prompt: "x" });
    expect(result.success).toBe(false);
    expect(result.status).toBe(404);
    expect(state.sessions).toBe(1);
    expect(state.archived).toEqual(["sess_1"]);
  });

  it("fails fast when the session is terminated before it starts", async () => {
    fakeCloud({ turn: (sid) => [{ id: `${sid}_1`, type: "session.status_terminated" }] });
    const started = Date.now();
    const result = await generate({ prompt: "x" });
    expect(result.status).toBe(502);
    expect(result.error).toContain("terminated");
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("finds an existing environment on a later list page instead of creating a duplicate", async () => {
    const { calls } = fakeCloud({
      environmentPages: [
        [{ id: "env_a", name: "other" }, { id: "env_b", name: "another" }],
        [{ id: "env_9r", name: "9router" }],
      ],
    });
    const result = await generate({ prompt: "x" });
    expect(result.success).toBe(true);
    expect(calls.filter((c) => c.method === "POST" && c.path.endsWith("/environments"))).toHaveLength(0);
    expect(calls.some((c) => c.path.includes("/environments?") && c.path.includes("after_id=env_b"))).toBe(true);
  });

  it("does not record usage when the response cannot be built", async () => {
    fakeCloud();
    const failingFetch = global.fetch;
    global.fetch = vi.fn((url, opts) => (String(url).includes("files.example.com") ? Promise.resolve(new Response("gone", { status: 410 })) : failingFetch(url, opts)));
    const onUsage = vi.fn();
    const result = await generate({ prompt: "x", response_format: "b64_json" }, undefined, { onUsage });
    expect(result.success).toBe(false);
    expect(onUsage).not.toHaveBeenCalled();
  });

  it("gives the agent only the ImageGen and DeliverArtifacts tools", async () => {
    const { calls } = fakeCloud();
    await generate({ prompt: "x" });
    const agentCall = calls.find((c) => c.method === "POST" && c.path.endsWith("/agents"));
    const agent = JSON.parse(agentCall.body);
    expect(agent.name).toBe("9router-imagegen-v2");
    expect(agent.tools[0].enabled_tools).toEqual(["ImageGen", "DeliverArtifacts"]);
  });
});
