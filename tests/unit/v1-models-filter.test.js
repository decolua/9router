import { beforeEach, describe, expect, it, vi } from "vitest";

// Exercise GET /v1/models query-param filtering. The catalog is driven through a
// real buildModelsList() with a controlled connection, so filters run against
// real capability/context data rather than a stub.
const db = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
}));

vi.mock("@/lib/localDb", () => db);
vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn(async () => ({})),
}));

const { GET } = await import("../../src/app/api/v1/models/route.js");

// Plain Request has no nextUrl — mirrors how a request arrives without filters.
function rawRequest(url = "https://router.test/v1/models") {
  return new Request(url);
}

// Minimal NextRequest stand-in so the handler can read searchParams.
function nextRequest(query = "") {
  const url = new URL(`https://router.test/v1/models${query}`);
  return {
    url: url.toString(),
    headers: new Headers(),
    nextUrl: { pathname: url.pathname, searchParams: url.searchParams },
  };
}

const tails = (body) => body.data.map((m) => m.id.split("/").pop());

describe("GET /v1/models — query-param filtering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.getProviderConnections.mockResolvedValue([
      {
        id: "c1",
        provider: "deepseek",
        isActive: true,
        providerSpecificData: { enabledModels: ["deepseek-v4.1-flash", "deepseek-chat"] },
      },
    ]);
  });

  it("returns the unchanged list when no filter param is present (byte-compat guard)", async () => {
    const bareRes = await GET(rawRequest());
    const bare = await bareRes.json();

    expect(bareRes.status).toBe(200);
    expect(bare.object).toBe("list");
    expect(tails(bare).sort()).toEqual(["deepseek-chat", "deepseek-v4.1-flash"]);

    // An unrelated param must not change a single byte of the response.
    const unrelatedRes = await GET(nextRequest("?foo=bar"));
    const unrelated = await unrelatedRes.json();
    expect(JSON.stringify(unrelated)).toBe(JSON.stringify(bare));
  });

  it("narrows by capability", async () => {
    const body = await (await GET(nextRequest("?capability=vision"))).json();
    expect(tails(body)).toEqual(["deepseek-v4.1-flash"]);
  });

  it("treats repeated and comma-separated capabilities as AND", async () => {
    const repeated = await (await GET(nextRequest("?capability=vision&capability=reasoning"))).json();
    const comma = await (await GET(nextRequest("?capability=vision,reasoning"))).json();
    expect(tails(repeated)).toEqual(["deepseek-v4.1-flash"]);
    expect(tails(comma)).toEqual(tails(repeated));

    const both = await (await GET(nextRequest("?capability=tools&capability=vision"))).json();
    expect(tails(both)).toEqual(["deepseek-v4.1-flash"]);

    // pdf is in the vocabulary but false on both models → empty, not a 400.
    const none = await (await GET(nextRequest("?capability=pdf"))).json();
    expect(tails(none)).toEqual([]);
  });

  it("rejects an unknown capability with the valid vocabulary", async () => {
    const res = await GET(nextRequest("?capability=telepathy"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.message).toContain("telepathy");
    expect(body.error.message).toContain("vision");
    expect(body.error.message).toContain("tools");
    expect(body.error.message).toContain("reasoning");
  });

  it("narrows by min_context", async () => {
    const kept = await (await GET(nextRequest("?min_context=500000"))).json();
    expect(tails(kept)).toEqual(["deepseek-v4.1-flash"]);

    const all = await (await GET(nextRequest("?min_context=1000"))).json();
    expect(tails(all).sort()).toEqual(["deepseek-chat", "deepseek-v4.1-flash"]);
  });

  it("rejects a non-numeric min_context", async () => {
    const res = await GET(nextRequest("?min_context=abc"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.message).toContain("min_context");
  });

  it("narrows by kind, treating an absent kind as llm", async () => {
    const llm = await (await GET(nextRequest("?kind=llm"))).json();
    expect(tails(llm).sort()).toEqual(["deepseek-chat", "deepseek-v4.1-flash"]);

    const image = await (await GET(nextRequest("?kind=image"))).json();
    expect(tails(image)).toEqual([]);
  });

  it("narrows by q case-insensitively over id and display name", async () => {
    const hit = await (await GET(nextRequest("?q=CHAT"))).json();
    expect(tails(hit)).toEqual(["deepseek-chat"]);

    const miss = await (await GET(nextRequest("?q=there-is-no-such-model"))).json();
    expect(tails(miss)).toEqual([]);
  });

  it("truncates after filtering when limit is given", async () => {
    const all = await (await GET(nextRequest("?limit=10"))).json();
    expect(tails(all)).toHaveLength(2);

    const one = await (await GET(nextRequest("?min_context=500000&limit=1"))).json();
    expect(tails(one)).toHaveLength(1);
  });

  it("rejects a non-positive or non-integer limit", async () => {
    expect((await GET(nextRequest("?limit=0"))).status).toBe(400);
    expect((await GET(nextRequest("?limit=-3"))).status).toBe(400);
    expect((await GET(nextRequest("?limit=abc"))).status).toBe(400);
    expect((await GET(nextRequest("?limit=1.5"))).status).toBe(400);
  });
});
