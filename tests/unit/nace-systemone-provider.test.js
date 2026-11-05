import { afterEach, describe, expect, it, vi } from "vitest";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDER_MEDIA } from "../../open-sse/providers/index.js";
import { buildSystemoneUrl, handleSystemoneCore } from "../../open-sse/handlers/systemoneCore.js";
import { getProvidersByKind } from "@/shared/constants/providers";

const NACE_URL = "https://console.nace.ai/v1/systemone";
const cfg = PROVIDER_MEDIA["nace"]?.systemoneConfig;

describe("Nace Drex System One provider", () => {
  const entry = REGISTRY.find((e) => e.id === "nace");

  it("is registered as a System One apikey provider", () => {
    expect(entry).toBeDefined();
    expect(entry.category).toBe("apikey");
    expect(entry.serviceKinds).toEqual(["systemone"]);
    expect(cfg?.baseUrl).toBe(NACE_URL);
    expect(cfg?.path).toBe("/v1/systemone");
  });

  it("appears in getProvidersByKind('systemone')", () => {
    const found = getProvidersByKind("systemone").find((p) => p.id === "nace");
    expect(found).toBeDefined();
    expect(found.alias).toBe("nace");
    expect(found.systemoneConfig?.baseUrl).toBe(NACE_URL);
  });

  it("lists drex-max and drex-v2.0 as System One models", () => {
    const kinds = Object.fromEntries(entry.models.map((m) => [m.id, m.kind]));
    expect(kinds).toEqual({ "drex-max": "systemone", "drex-v2.0": "systemone" });
  });

  it.each([
    [undefined, NACE_URL],
    ["https://gateway.example", "https://gateway.example/v1/systemone"],
    ["https://gateway.example/v1/", "https://gateway.example/v1/systemone"],
    ["https://gateway.example/v1/systemone", "https://gateway.example/v1/systemone"],
  ])("joins a saved host %s with the registry path", (host, expected) => {
    expect(buildSystemoneUrl(host, cfg)).toBe(expected);
  });
});

describe("handleSystemoneCore for nace", () => {
  afterEach(() => vi.unstubAllGlobals());

  // Shape documented at https://console.nace.ai/docs/drex/guides/drex-max: a score answer
  // carries `legend` as an array and every answer carries `confidence`.
  const upstreamReply = {
    model: "drex-max",
    answers: {
      next: { type: "choice", choice: "E1", confidence: 0.9987, probabilities: { E1: 0.9991, E2: 0.0007 } },
      done: { type: "noul", noul: 0.0017 },
      grade: {
        type: "score",
        score: 0.93,
        legend: ["unclear", "partly clear", "clear"],
        probabilities: { 0: 0.133, 1: 0.803, 2: 0.063 },
        confidence: 0.705,
      },
    },
    usage: { input_tokens: 307, output_tokens: 311 },
    evaluation_time_ms: 180.8,
    request_id: "req_test",
  };

  const body = {
    state: "Inspect Image 1.",
    images: ["data:image/png;base64,iVBORw0KGgo="],
    questions: {
      next: { type: "choice", instructions: "Which element next?", criteria: { E1: "the button", E2: null } },
      done: { type: "noul", instructions: "Is the task complete?" },
      grade: { type: "score", instructions: "How clear is the image?", criteria: ["unclear", "partly clear", "clear"] },
    },
  };

  async function call(model, credentials) {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(upstreamReply), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await handleSystemoneCore({ body, modelInfo: { provider: "nace", model }, credentials });
    const [url, init] = fetchMock.mock.calls[0];
    return { result, url, headers: init.headers, sent: JSON.parse(init.body) };
  }

  it("posts to console.nace.ai with Bearer auth and no OpenCode session header", async () => {
    const r = await call("drex-max", { apiKey: "nace_sk_test" });
    expect(r.result.success).toBe(true);
    expect(r.url).toBe(NACE_URL);
    expect(r.headers.Authorization).toBe("Bearer nace_sk_test");
    expect(r.headers["Content-Type"]).toBe("application/json");
    expect(r.headers["x-opencode-session"]).toBeUndefined();
  });

  it("forwards the model id, state, questions and top-level images array untouched", async () => {
    const r = await call("drex-max", { apiKey: "k" });
    expect(r.sent).toEqual({ ...body, model: "drex-max" });
  });

  it("keeps drex-v2.0 as the upstream model id", async () => {
    const r = await call("drex-v2.0", { apiKey: "k" });
    expect(r.sent.model).toBe("drex-v2.0");
  });

  it("returns the Drex reply unchanged (array legend, confidence) and maps usage", async () => {
    const r = await call("drex-max", { apiKey: "k" });
    expect(await r.result.response.json()).toEqual(upstreamReply);
    expect(r.result.usage).toEqual({ prompt_tokens: 307, completion_tokens: 311 });
  });

  it("uses a saved host override joined with the registry path", async () => {
    const r = await call("drex-max", { apiKey: "k", providerSpecificData: { baseUrl: "https://gateway.example/v1" } });
    expect(r.url).toBe("https://gateway.example/v1/systemone");
  });
});
