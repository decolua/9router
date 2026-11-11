import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CUSTOM_HEADER_MASK } from "open-sse/config/customHeaders.js";

const db = vi.hoisted(() => ({ nodes: new Map(), connections: new Map() }));

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), { status: init.status || 200, headers: { "Content-Type": "application/json" } });
    },
  },
}));

const repo = vi.hoisted(() => ({
  getProviderNodes: async () => [...db.nodes.values()],
  getProviderNodeById: async (id) => db.nodes.get(id) || null,
  createProviderNode: async (data) => {
    const node = { ...data, ...(data.customHeaders?.length ? {} : { customHeaders: undefined }) };
    if (!node.customHeaders) delete node.customHeaders;
    db.nodes.set(node.id, node);
    return node;
  },
  updateProviderNode: async (id, data) => {
    const merged = { ...db.nodes.get(id), ...data };
    db.nodes.set(id, merged);
    return merged;
  },
  getProviderConnections: async () => [],
  getProviderConnectionById: async (id) => db.connections.get(id) || null,
  updateProviderConnection: vi.fn(),
  deleteProviderConnectionsByProvider: vi.fn(),
  deleteProviderNode: vi.fn(),
}));

vi.mock("@/models", () => repo);
vi.mock("@/lib/localDb", () => repo);
vi.mock("@/dashboardGuard", () => ({ isLocalRequest: () => true }));

const nodesRoute = await import("../../src/app/api/provider-nodes/route.js");
const nodeRoute = await import("../../src/app/api/provider-nodes/[id]/route.js");
const validateRoute = await import("../../src/app/api/provider-nodes/validate/route.js");
const modelsRoute = await import("../../src/app/api/providers/[id]/models/route.js");

const originalFetch = global.fetch;
const jsonReq = (url, method, body) => new Request(`http://localhost${url}`, {
  method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const SECRET = "gw-secret-9876";

async function createNode(extra = {}) {
  const res = await nodesRoute.POST(jsonReq("/api/provider-nodes", "POST", {
    name: "Azure GW", prefix: "az", apiType: "chat", baseUrl: "https://gw.example/v1", type: "openai-compatible",
    customHeaders: [
      { name: "Authorization", value: "" },
      { name: "api-key", value: "{{API_KEY}}" },
      { name: "X-Gateway-Token", value: SECRET },
    ],
    ...extra,
  }));
  return { res, body: await res.json() };
}

describe("provider-nodes API with customHeaders", () => {
  beforeEach(() => {
    db.nodes.clear();
    db.connections.clear();
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "m1" }] }), { status: 200 }));
  });
  afterAll(() => { global.fetch = originalFetch; });

  it("POST stores raw values but returns them masked", async () => {
    const { res, body } = await createNode();
    expect(res.status).toBe(201);
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(body.node.customHeaders).toEqual([
      { name: "Authorization", value: "" },
      { name: "api-key", value: CUSTOM_HEADER_MASK },
      { name: "X-Gateway-Token", value: CUSTOM_HEADER_MASK },
    ]);
    expect(db.nodes.get(body.node.id).customHeaders[2].value).toBe(SECRET);
  });

  it("POST rejects invalid headers with 400 and creates nothing", async () => {
    for (const customHeaders of [
      [{ name: "Host", value: "x" }],
      [{ name: "X-A", value: "a\r\nb" }],
      [{ name: "Bad Name", value: "x" }],
    ]) {
      const { res, body } = await createNode({ customHeaders });
      expect(res.status).toBe(400);
      expect(body.error).toBeTruthy();
    }
    expect(db.nodes.size).toBe(0);
  });

  it("POST ignores customHeaders for custom-embedding nodes", async () => {
    const { res, body } = await createNode({ type: "custom-embedding" });
    expect(res.status).toBe(201);
    expect(db.nodes.get(body.node.id).customHeaders).toBeUndefined();
  });

  it("GET list masks values", async () => {
    await createNode();
    const body = await (await nodesRoute.GET()).json();
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  it("PUT keeps masked values, updates re-typed ones, omitting keeps all, 400 on invalid", async () => {
    const { body: created } = await createNode();
    const id = created.node.id;
    const put = async (extra) => nodeRoute.PUT(
      jsonReq(`/api/provider-nodes/${id}`, "PUT", { name: "Azure GW", prefix: "az", apiType: "chat", baseUrl: "https://gw.example/v1", ...extra }),
      { params: Promise.resolve({ id }) },
    );

    // round-trip the masked list from the API + one change
    const masked = created.node.customHeaders.map((h) => (h.name === "api-key" ? { ...h, value: "{{API_KEY}}x" } : h));
    let res = await put({ customHeaders: masked });
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain(SECRET);
    expect(db.nodes.get(id).customHeaders).toEqual([
      { name: "Authorization", value: "" },
      { name: "api-key", value: "{{API_KEY}}x" },
      { name: "X-Gateway-Token", value: SECRET },
    ]);

    res = await put({});
    expect(res.status).toBe(200);
    expect(db.nodes.get(id).customHeaders[2].value).toBe(SECRET);

    res = await put({ customHeaders: [{ name: "Connection", value: "close" }] });
    expect(res.status).toBe(400);
    expect(db.nodes.get(id).customHeaders[2].value).toBe(SECRET);

    res = await put({ customHeaders: [{ name: "X-Renamed", value: CUSTOM_HEADER_MASK }] });
    expect(res.status).toBe(400);

    res = await put({ customHeaders: [] });
    expect(res.status).toBe(200);
    expect(db.nodes.get(id).customHeaders).toEqual([]);
  });

  it("validate (Check) applies body headers, resolves masks via nodeId, 400 on invalid", async () => {
    const { body: created } = await createNode();
    const validate = (extra) => validateRoute.POST(jsonReq("/api/provider-nodes/validate", "POST", {
      baseUrl: "https://gw.example/v1", apiKey: "sk-check", type: "openai-compatible", ...extra,
    }));

    let res = await validate({ customHeaders: [{ name: "Authorization", value: "" }, { name: "api-key", value: "{{API_KEY}}" }] });
    expect((await res.json()).valid).toBe(true);
    let sent = global.fetch.mock.calls.at(-1)[1].headers;
    expect(sent).toEqual({ "api-key": "sk-check" });

    res = await validate({ nodeId: created.node.id, customHeaders: created.node.customHeaders });
    sent = global.fetch.mock.calls.at(-1)[1].headers;
    expect(sent["X-Gateway-Token"]).toBe(SECRET);

    res = await validate({ customHeaders: [{ name: "Transfer-Encoding", value: "chunked" }] });
    expect(res.status).toBe(400);
  });

  it("model discovery for a compatible connection sends node headers", async () => {
    const { body: created } = await createNode();
    db.connections.set("c1", { id: "c1", provider: created.node.id, apiKey: "sk-conn", providerSpecificData: { baseUrl: "https://gw.example/v1" } });
    const res = await modelsRoute.GET(new Request("http://localhost/api/providers/c1/models"), { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(200);
    const [url, init] = global.fetch.mock.calls.at(-1);
    expect(url).toBe("https://gw.example/v1/models");
    expect(init.headers).toEqual({ "Content-Type": "application/json", "api-key": "sk-conn", "X-Gateway-Token": SECRET });
  });
});
