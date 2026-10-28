import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  connection: vi.fn(),
  proxy: vi.fn(async () => ({
    enabled: true,
    url: "http://proxy.fixture",
    strictProxy: true
  })),
  fetch: vi.fn()
}));
vi.mock("@/models", () => ({
  getProviderConnectionById: mocks.connection
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.proxy
}));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: mocks.fetch
}));
import { GET } from "../../src/app/api/providers/[id]/models/route.js";
const connection = {
  id: "fixture",
  provider: "cloudflare-ai",
  apiKey: "fixture-token",
  providerSpecificData: {
    accountId: "fixture-account",
    proxyPoolId: "fixture-pool"
  }
};
const run = () => GET(new Request("https://router.fixture/api/providers/fixture/models"), {
  params: Promise.resolve({
    id: "fixture"
  })
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.connection.mockResolvedValue(connection);
});
describe("Cloudflare model discovery", () => {
  it("uses inference names instead of UUIDs and filters unsupported model kinds", async () => {
    mocks.fetch.mockResolvedValue(Response.json({
      result: [{
        id: "uuid-1",
        name: "@cf/meta/llama-3.3-70b-instruct"
      }, {
        id: "uuid-2",
        name: "@cf/black-forest-labs/flux-2-dev"
      }, {
        id: "uuid-3",
        name: "@cf/baai/bge-base-en-v1.5"
      }, {
        id: "uuid-4",
        name: "@cf/cloudflare/clef-flash"
      }]
    }));
    const response = await run();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.models).toHaveLength(2);
    expect(body.models[0].id).toBe("@cf/meta/llama-3.3-70b-instruct");
    expect(body.models[1].kind).toBe("image");
    const [url, init, proxy] = mocks.fetch.mock.calls[0];
    expect(url).toContain("/accounts/fixture-account/ai/models/search");
    expect(init.headers.Authorization).toBe("Bearer fixture-token");
    expect(proxy.strictProxy).toBe(true);
    expect(mocks.proxy).toHaveBeenCalledWith(connection.providerSpecificData);
  });
  it("retains the static catalog with a warning on upstream failure", async () => {
    mocks.fetch.mockResolvedValue(new Response("denied", {
      status: 403
    }));
    const body = await (await run()).json();
    expect(body.models.length).toBeGreaterThan(0);
    expect(body.warning).toContain("403");
  });
  it("follows pagination and accepts routing ids in the id field", async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({
      result: [{
        id: "@cf/vendor/first",
        name: "First model"
      }],
      result_info: {
        page: 1,
        total_pages: 2
      }
    })).mockResolvedValueOnce(Response.json({
      result: [{
        id: "uuid",
        name: "@cf/vendor/second"
      }],
      result_info: {
        page: 2,
        total_pages: 2
      }
    }));
    const body = await (await run()).json();
    expect(body.models.map(m => m.id)).toEqual(["@cf/vendor/first", "@cf/vendor/second"]);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch.mock.calls[1][0]).toContain("page=2");
  });
  it("falls back when an HTTP 200 carries API errors", async () => {
    mocks.fetch.mockResolvedValue(Response.json({
      success: false,
      errors: [{
        message: "denied"
      }]
    }));
    const body = await (await run()).json();
    expect(body.warning).toContain("API error");
    expect(body.models.length).toBeGreaterThan(0);
  });
  it("does not fetch when the account id is absent", async () => {
    mocks.connection.mockResolvedValue({
      ...connection,
      providerSpecificData: {}
    });
    expect((await run()).status).toBe(400);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("encodes the account id in the fixed Cloudflare host", async () => {
    mocks.connection.mockResolvedValue({
      ...connection,
      providerSpecificData: {
        accountId: "account/other"
      }
    });
    mocks.fetch.mockResolvedValue(Response.json({
      result: []
    }));
    await run();
    expect(mocks.fetch.mock.calls[0][0]).toContain("account%2Fother");
  });
});
