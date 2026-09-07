import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CODEX_CLIENT_VERSION } from "../../open-sse/config/codexConstants.js";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import imageProvider from "../../open-sse/handlers/imageProviders/codex.js";
import * as proxyFetch from "../../open-sse/utils/proxyFetch.js";

const mocks = vi.hoisted(() => ({
  connection: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/models", () => ({ getProviderConnectionById: mocks.connection }));
vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.connection,
  updateProviderConnection: mocks.update,
}));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: async () => ({}) }));
vi.mock("@/sse/services/tokenRefresh", () => ({
  refreshCodexToken: vi.fn(), refreshGoogleToken: vi.fn(), updateProviderCredentials: vi.fn(),
}));

const credentials = {
  accessToken: "test-token",
  connectionId: "test-connection",
  providerSpecificData: { chatgptAccountId: "test-account" },
};

function expectIdentity(rawHeaders) {
  const headers = new Headers(rawHeaders);
  expect(headers.get("version")).toBe(CODEX_CLIENT_VERSION);
  expect(headers.get("user-agent")).toBe(`codex_cli_rs/${CODEX_CLIENT_VERSION}`);
  expect(headers.get("originator")).toBe("codex_cli_rs");
}

describe("Codex identity across discovery and requests", () => {
  beforeEach(() => {
    mocks.connection.mockResolvedValue({
      id: "test-connection", provider: "codex", authType: "oauth",
      ...credentials, expiresAt: "2099-01-01T00:00:00Z",
    });
    mocks.update.mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("advertises at least the GPT-5.6 manifest's minimum version", () => {
    // Pinned upstream manifest: openai/codex@0df39752, models-manager/models.json.
    const [major, minor] = CODEX_CLIENT_VERSION.split(".").map(Number);
    expect(major > 0 || minor >= 144).toBe(true);
  });

  it.each([true, false])("uses the same identity for chat and image (stream=%s)", (stream) => {
    const chatHeaders = new CodexExecutor().buildHeaders(credentials, stream);
    const imageHeaders = imageProvider.buildHeaders(credentials);
    expectIdentity(chatHeaders);
    expectIdentity(imageHeaders);
    for (const raw of [chatHeaders, imageHeaders]) {
      const headers = new Headers(raw);
      expect(headers.get("authorization")).toBe("Bearer test-token");
      expect(headers.get("chatgpt-account-id")).toBe("test-account");
      expect(headers.get("session_id")).toBeTruthy();
    }
  });

  it("sends matching identity headers with the discovery client_version", async () => {
    const fetch = vi.fn(async () => Response.json({ models: [{ slug: "gpt-5.6-luna" }] }));
    vi.stubGlobal("fetch", fetch);
    const { GET } = await import("../../src/app/api/providers/[id]/models/route.js");
    const response = await GET(new Request("http://localhost/api/providers/test-connection/models"), {
      params: Promise.resolve({ id: "test-connection" }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).models.some((model) => model.id === "gpt-5.6-luna")).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0];
    expect(new URL(url).searchParams.get("client_version")).toBe(CODEX_CLIENT_VERSION);
    expectIdentity(options.headers);
    expect(new Headers(options.headers).get("authorization")).toBe("Bearer test-token");
  });

  it("tests credentials with the same identity as generation", async () => {
    const fetch = vi.fn(async () => Response.json({ detail: "Missing input" }, { status: 400 }));
    vi.stubGlobal("fetch", fetch);
    const { testSingleConnection } = await import("../../src/app/api/providers/[id]/test/testUtils.js");
    expect((await testSingleConnection("test-connection")).valid).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expectIdentity(fetch.mock.calls[0][1].headers);
  });

  it.each(["gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra"])("passes a version-gated upstream without rewriting %s", async (model) => {
    const fetch = vi.spyOn(proxyFetch, "proxyAwareFetch").mockImplementation(async (_url, options) => {
      const headers = new Headers(options.headers);
      if (headers.get("version") !== CODEX_CLIENT_VERSION ||
          headers.get("user-agent") !== `codex_cli_rs/${CODEX_CLIENT_VERSION}`) {
        return Response.json({ detail: `The '${model}' model requires a newer version of Codex.` }, { status: 400 });
      }
      return Response.json({ id: "response-test", output: [] });
    });
    const result = await new CodexExecutor().execute({
      model, body: { model, input: "hello" }, stream: true, credentials,
    });
    expect(result.response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0][1].body).model).toBe(model);
  });
});
