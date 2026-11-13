import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ connections: vi.fn(), create: vi.fn() }));
vi.mock("next/server", () => ({ NextResponse: { json: (body, init) => ({ body, status: init?.status || 200 }) } }));
vi.mock("@/models", () => ({ getProviderConnections: mocks.connections, createProviderConnection: mocks.create, getProviderNodes: async () => [], getProviderNodeById: vi.fn(), getProxyPoolById: vi.fn() }));
vi.mock("@/shared/constants/config", () => ({ APIKEY_PROVIDERS: { openai: {} } }));
vi.mock("@/shared/constants/providers", () => ({ AI_PROVIDERS: {}, FREE_TIER_PROVIDERS: {}, WEB_COOKIE_PROVIDERS: {}, isOpenAICompatibleProvider: () => false, isAnthropicCompatibleProvider: () => false, isCustomEmbeddingProvider: () => false }));
vi.mock("@/lib/providerNormalization", () => ({ normalizeProviderId: x => x, normalizeProviderSpecificData: (_p, x) => x }));
const { GET, POST } = await import("../../src/app/api/providers/route.js");
const rows = Array.from({ length: 250 }, (_, i) => ({ id: String(i), provider: i % 2 ? "other" : "openai", name: `Account ${i}`, email: `user${i}@test.invalid`, apiKey: "secret" }));
beforeEach(() => { vi.clearAllMocks(); mocks.create.mockReset(); mocks.connections.mockResolvedValue(rows); });
const get = async (query = "") => (await GET(new Request(`http://localhost/api/providers${query}`))).body;
describe("provider POST collision protections", () => {
  const post = body => POST(new Request("http://localhost/api/providers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "openai", name: "existing", apiKey: "secret", ...body }) }));
  it("returns 409 collision metadata and refuses implicit overwrite", async () => {
    mocks.create.mockRejectedValue(Object.assign(new Error("Name already exists"), { code: "PROVIDER_NAME_CONFLICT", existingId: "old", existingName: "existing" }));
    const result = await post({});
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ code: "PROVIDER_NAME_CONFLICT", existingId: "old", existingName: "existing" });
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ allowOverwrite: false }));
  });
  it.each([{ id: "old" }, { allowOverwrite: true }, { overwrite: true }])("retains explicit overwrite behavior %j", async body => {
    mocks.create.mockResolvedValue({ id: "old", apiKey: "secret" });
    const result = await post(body);
    expect(result.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ allowOverwrite: true }));
    expect(result.body.connection).not.toHaveProperty("apiKey");
  });
});

describe("provider pagination", () => {
  it("keeps all rows when pagination omitted and hides secrets", async () => { const b = await get(); expect(b.connections).toHaveLength(250); expect(b.connections[0].apiKey).toBeUndefined(); });
  it("filters provider before counting", async () => { const b = await get("?provider=openai"); expect(b.total).toBe(125); expect(b.connections.every(c => c.provider === "openai")).toBe(true); });
  it("matches trimmed case-insensitive search", async () => { expect((await get("?q=%20USER249%20")).connections.map(c => c.id)).toEqual(["249"]); });
  it("paginates after filtering", async () => { expect((await get("?provider=openai&page=2&pageSize=2")).connections.map(c => c.id)).toEqual(["4", "6"]); });
  it("clamps negative page and pageSize", async () => { const b = await get("?page=-2&pageSize=-5"); expect(b.page).toBe(1); expect(b.pageSize).toBe(1); expect(b.connections).toHaveLength(1); });
  it("caps pageSize at 200", async () => { const b = await get("?pageSize=999"); expect(b.connections).toHaveLength(200); expect(b.pageSize).toBe(200); });
  it("returns empty page beyond end", async () => { const b = await get("?page=999"); expect(b.connections).toEqual([]); expect(b.total).toBe(250); });
});
