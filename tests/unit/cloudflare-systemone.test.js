import { afterEach, describe, expect, it, vi } from "vitest";
import cloudflareAi from "../../open-sse/providers/registry/cloudflare-ai.js";
import { getModelMeta, getModelUpstreamId } from "../../open-sse/config/providerModels.js";
import { handleSystemoneCore, validateSystemonePayload } from "../../open-sse/handlers/systemoneCore.js";

describe("cloudflare-ai System One models (#5748)", () => {
  it("declares clef, clef-omni, clef-flash, and clairic with short upstreamModelId selectors", () => {
    const systemoneModels = cloudflareAi.models.filter((m) => m.kind === "systemone");
    const byId = Object.fromEntries(systemoneModels.map((m) => [m.id, m]));

    expect(byId["@cf/cloudflare/clef-flash"]).toMatchObject({
      name: "Clef Flash",
      kind: "systemone",
      upstreamModelId: "clef-flash",
    });
    expect(byId["@cf/cloudflare/clef"]).toMatchObject({
      name: "Clef",
      kind: "systemone",
      upstreamModelId: "clef",
    });
    expect(byId["@cf/cloudflare/clef-omni"]).toMatchObject({
      name: "Clef Omni",
      kind: "systemone",
      upstreamModelId: "clef-omni",
    });
    expect(byId["@cf/cloudflare/clairic"]).toMatchObject({
      name: "Clairic",
      kind: "systemone",
      upstreamModelId: "clairic",
      payloadShape: "fields",
    });

    expect(getModelUpstreamId("cloudflare-ai", "@cf/cloudflare/clef")).toBe("clef");
    expect(getModelUpstreamId("cloudflare-ai", "@cf/cloudflare/clef-omni")).toBe("clef-omni");
    expect(getModelUpstreamId("cloudflare-ai", "@cf/cloudflare/clef-flash")).toBe("clef-flash");
    expect(getModelUpstreamId("cloudflare-ai", "@cf/cloudflare/clairic")).toBe("clairic");
    expect(getModelMeta("cloudflare-ai", "@cf/cloudflare/clairic")?.payloadShape).toBe("fields");
  });
});

describe("handleSystemoneCore for cloudflare-ai decision, extraction, and custom models (#5748)", () => {
  afterEach(() => vi.unstubAllGlobals());

  const credentials = {
    apiKey: "cf_test_token",
    providerSpecificData: { accountId: "acc_12345" },
  };

  async function callCf(modelInfo, body, reply = { answers: { urgent: { type: "noul", noul: 0.91 } }, usage: { input_tokens: 42, output_tokens: 0 } }) {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(reply), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await handleSystemoneCore({ body, modelInfo, credentials });
    const callEntry = fetchMock.mock.calls[0];
    return {
      result,
      called: Boolean(callEntry),
      url: callEntry?.[0],
      headers: callEntry?.[1]?.headers,
      sent: callEntry ? JSON.parse(callEntry[1].body) : null,
    };
  }

  it.each([
    ["@cf/cloudflare/clef", "clef"],
    ["@cf/cloudflare/clef-omni", "clef-omni"],
    ["@cf/cloudflare/clef-flash", "clef-flash"],
  ])("routes %s to its Workers AI path while rewriting body.model to %s", async (fullId, shortSelector) => {
    const body = {
      state: "Customer checkout failed with HTTP 502.",
      questions: { urgent: { type: "noul", instructions: "Is this urgent?" } },
    };
    const r = await callCf({ provider: "cloudflare-ai", model: fullId }, body);
    expect(r.result.success).toBe(true);
    expect(r.url).toBe(`https://api.cloudflare.com/client/v4/accounts/acc_12345/ai/run/${fullId}`);
    expect(r.headers.Authorization).toBe("Bearer cf_test_token");
    expect(r.sent).toEqual({ ...body, model: shortSelector });
  });

  it("accepts fields payload for @cf/cloudflare/clairic and rejects missing fields", async () => {
    const extractionBody = {
      state: "Invoice #99812 from Acme Corp. Total due: $1,450.00.",
      fields: {
        invoice_number: { type: "text" },
        total_amount: { type: "number" },
      },
    };
    const extractionReply = {
      model: "clairic",
      values: {
        invoice_number: { value: "99812", confidence: 0.99 },
        total_amount: { value: 1450, confidence: 0.98 },
      },
      usage: { input_tokens: 64, output_tokens: 0 },
    };

    const ok = await callCf(
      { provider: "cloudflare-ai", model: "@cf/cloudflare/clairic" },
      extractionBody,
      extractionReply
    );
    expect(ok.result.success).toBe(true);
    expect(ok.url).toBe("https://api.cloudflare.com/client/v4/accounts/acc_12345/ai/run/@cf/cloudflare/clairic");
    expect(ok.sent).toEqual({ ...extractionBody, model: "clairic" });

    // Missing `fields` on clairic fails closed with 400
    const bad = await callCf(
      { provider: "cloudflare-ai", model: "@cf/cloudflare/clairic" },
      { state: "Invoice #99812", questions: { q: { type: "noul" } } }
    );
    expect(bad.result.success).toBe(false);
    expect(bad.result.status).toBe(400);
    expect(bad.called).toBe(false);
    expect(validateSystemonePayload({ state: "x" }, "cloudflare-ai", "@cf/cloudflare/clairic")).toBe(
      "Missing required field: fields"
    );
  });

  it("honors custom model upstreamModelId when forwarding unregistered decision models", async () => {
    const body = {
      state: "Classify support ticket.",
      questions: { team: { type: "choice", criteria: { billing: "payment", ops: "infra" } } },
    };
    const r = await callCf(
      {
        provider: "cloudflare-ai",
        model: "@cf/cloudflare/clef-custom",
        upstreamModelId: "clef-custom",
      },
      body
    );
    expect(r.result.success).toBe(true);
    expect(r.url).toBe("https://api.cloudflare.com/client/v4/accounts/acc_12345/ai/run/@cf/cloudflare/clef-custom");
    expect(r.sent.model).toBe("clef-custom");
  });
});

describe("aliasRepo.addCustomModel upstreamModelId persistence (#5748)", () => {
  it("persists upstreamModelId on insert and preserves it across partial updates", async () => {
    const store = new Map();
    vi.resetModules();
    vi.doMock("../../src/lib/db/driver.js", () => ({
      getAdapter: async () => ({
        transaction: (fn) => fn(),
        get: (_sql, [key]) => (store.has(key) ? { value: store.get(key) } : undefined),
        run: (sql, params) => {
          if (sql.startsWith("INSERT")) {
            store.set(params[0], params[1]);
          } else if (sql.startsWith("UPDATE")) {
            store.set(params[1], params[0]);
          }
        },
        all: () => [...store.entries()].map(([key, value]) => ({ key, value })),
      }),
    }));

    const { addCustomModel } = await import("../../src/lib/db/repos/aliasRepo.js");
    const inserted = await addCustomModel({
      providerAlias: "cloudflare-ai",
      id: "@cf/cloudflare/clef-next",
      type: "systemone",
      name: "Clef Next",
      upstreamModelId: "  clef-next  ",
    });
    expect(inserted).toBe(true);

    const updated = await addCustomModel({
      providerAlias: "cloudflare-ai",
      id: "@cf/cloudflare/clef-next",
      type: "systemone",
      name: "Clef Next Renamed",
    });
    expect(updated).toBe(false);

    const saved = JSON.parse(store.get("cloudflare-ai|@cf/cloudflare/clef-next|systemone"));
    expect(saved).toEqual({
      providerAlias: "cloudflare-ai",
      id: "@cf/cloudflare/clef-next",
      type: "systemone",
      name: "Clef Next Renamed",
      upstreamModelId: "clef-next",
    });
  });
});

describe("pingModelByKind for systemone decision vs extraction models (#5748)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends fields probe for @cf/cloudflare/clairic and questions probe for @cf/cloudflare/clef", async () => {
    vi.resetModules();
    vi.doMock("@/lib/localDb", () => ({ getApiKeys: async () => [] }));
    vi.doMock("@/shared/utils/machineId", () => ({ getConsistentMachineId: async () => "test-cli-token" }));

    const { pingModelByKind } = await import("../../src/app/api/models/test/ping.js");

    const fetchMock = vi.fn(async (_url, init) => {
      const sent = JSON.parse(init.body);
      if (sent.fields) {
        return new Response(JSON.stringify({ values: { probe: { value: "double charge", confidence: 0.97 } } }), { status: 200 });
      }
      return new Response(JSON.stringify({ answers: { probe: { type: "noul", noul: 0.95 } } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const clairicPing = await pingModelByKind("cf/@cf/cloudflare/clairic", "systemone", "http://127.0.0.1:20127");
    expect(clairicPing.ok).toBe(true);
    const clairicSent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(clairicSent.fields).toBeDefined();
    expect(clairicSent.questions).toBeUndefined();

    const clefPing = await pingModelByKind("cf/@cf/cloudflare/clef", "systemone", "http://127.0.0.1:20127");
    expect(clefPing.ok).toBe(true);
    const clefSent = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(clefSent.questions).toBeDefined();
    expect(clefSent.fields).toBeUndefined();
  });
});

const answers = { is_urgent: { type: "noul", noul: 0.9477 } };
const usage = { input_tokens: 162, output_tokens: 0 };

async function call(provider, model, upstreamBody, credentials = {}) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(upstreamBody), { status: 200 })));
  const result = await handleSystemoneCore({
    body: { state: "s", questions: { is_urgent: { type: "noul", instructions: "i" } } },
    modelInfo: { provider, model },
    credentials,
  });
  expect(result.success).toBe(true);
  return { result, json: await result.response.json() };
}

describe("handleSystemoneCore response envelope", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("unwraps Cloudflare's { result } envelope", async () => {
    // Shape returned by api.cloudflare.com/client/v4/accounts/<id>/ai/run/@cf/cloudflare/clef-flash
    const { result, json } = await call(
      "cloudflare-ai",
      "@cf/cloudflare/clef-flash",
      { result: { model: "clef-flash", answers, usage }, success: true, errors: [], messages: [] },
      { apiKey: "k", providerSpecificData: { accountId: "acc" } },
    );
    expect(json).toEqual({ model: "clef-flash", answers, usage });
    expect(result.usage).toEqual({ prompt_tokens: 162, completion_tokens: 0 });
  });

  it("forwards an unwrapped System One body untouched", async () => {
    const body = { model: "jev-1.13-free", answers, usage };
    const { json } = await call("opencode", "jev-1.13-free", body, { apiKey: "k" });
    expect(json).toEqual(body);
  });
});
