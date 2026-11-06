import { beforeEach, describe, expect, it, vi } from "vitest";
import { GrokWebExecutor } from "../../open-sse/executors/grok-web.js";
import { handleVideoProxyCore } from "../../open-sse/handlers/videoCore.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { grokTlsFetch } from "../../open-sse/services/grokTlsClient.js";
import { getExecutor } from "../../open-sse/executors/index.js";

// Keep optional dependencies of unrelated executors out of this regression.
// The selected Grok executor and the video core both remain real.
vi.mock("../../open-sse/executors/index.js", () => ({ getExecutor: vi.fn() }));

vi.mock("../../open-sse/services/grokTlsClient.js", () => ({
  GROK_TLS_USER_AGENT: "test-agent",
  GrokTlsUnavailableError: class extends Error {},
  grokTlsFetch: vi.fn(),
  isCloudflareChallenge: () => false,
}));

const credentials = { apiKey: "sso=test-session; cf_clearance=test-clearance" };
const generate = (body, action = "generations") => handleVideoProxyCore({
  provider: "grok-web", action, contentType: "application/json",
  rawBody: JSON.stringify({ model: "grok-video", prompt: "Animate the scene", ...body }), credentials,
});

beforeEach(() => {
  vi.clearAllMocks();
  getExecutor.mockReturnValue(new GrokWebExecutor());
  grokTlsFetch.mockImplementation(async (_url, options) => options.method === "POST"
    ? Response.json({ result: { video: { url: "https://assets.grok.com/fixture.mp4" } } })
    : new Response(Buffer.from("video fixture"), { headers: { "content-type": "video/mp4" } }));
});

describe.each(["generations", "edits"])("Grok Web %s reference validation (#5365)", (action) => {
  it.each([
    { image: "https://example.com/reference.png" },
    { image_url: "data:image/png;base64,aW1hZ2U=" },
    { images: ["https://example.com/one.png", "https://example.com/two.png"] },
    { image_urls: ["https://example.com/reference.png"] },
  ])("rejects reference input %j before creating an upstream job", async (body) => {
    const result = await generate(body, action);
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.response.status).toBe(400);
    expect(result.error).toMatch(/reference image/i);
    expect(checkFallbackError(result.status, result.error, 0, "grok-web"))
      .toMatchObject({ shouldFallback: false, cooldownMs: 0, requestScoped: true });
    expect(grokTlsFetch).not.toHaveBeenCalled();
  });
});

it.each([{}, { images: [] }])("keeps text-only video generation working for %j", async (body) => {
  const result = await generate({ size: "9:16", seconds: 8, ...body });
  expect(result.success).toBe(true);
  expect(await result.response.json()).toMatchObject({
    status: "completed", video: { url: `data:video/mp4;base64,${Buffer.from("video fixture").toString("base64")}` },
  });
  expect(grokTlsFetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(grokTlsFetch.mock.calls[0][1].body).mediaGenInput.textToVideo)
    .toMatchObject({ prompt: "Animate the scene", aspectRatio: "9:16", duration: 8 });
});

it("rejects a direct executor reference request before credential validation or network access", async () => {
  await expect(new GrokWebExecutor().generateMedia({
    prompt: "Animate the scene", kind: "video", images: ["https://example.com/reference.png"], credentials: {},
  })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/reference image/i) });
  expect(grokTlsFetch).not.toHaveBeenCalled();
});
