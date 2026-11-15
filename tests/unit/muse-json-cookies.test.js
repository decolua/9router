import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MuseWebExecutor } from "open-sse/executors/muse-web.js";
import { acquireBrowserContext } from "open-sse/services/browserPool.js";
import { fetchWebIdentity } from "open-sse/services/webIdentity.js";
import { normalizeSessionCookieHeader } from "open-sse/utils/webCookieAuth.js";

vi.mock("open-sse/services/browserPool.js", () => ({
  acquireBrowserContext: vi.fn(), releaseBrowserContext: vi.fn(),
}));
vi.mock("open-sse/executors/browserExecutableCheck.js", () => ({
  isMissingBrowserExecutable: () => false, resolveSystemChromeExecutable: () => null,
}));
vi.mock("open-sse/services/grokTlsClient.js", () => ({
  grokTlsFetch: vi.fn(), GROK_TLS_USER_AGENT: "test-agent",
}));

const cookies = [
  { name: "hatch_sess", value: "session==", domain: ".muse.ai", path: "/", httpOnly: true },
  { name: "hatch_gw", value: "gateway", domain: ".muse.ai", expirationDate: 1900000000 },
];
const header = "hatch_sess=session==; hatch_gw=gateway";
const exports = [JSON.stringify(cookies), JSON.stringify({ cookies })];

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
  acquireBrowserContext.mockRejectedValue(new Error("browser boundary"));
});
afterEach(() => vi.unstubAllGlobals());

describe("Muse Web exported cookie inputs (#5582)", () => {
  it.each(exports)("normalizes an exported jar before the identity probe: %s", async (raw) => {
    const result = await fetchWebIdentity("muse-web", raw);
    expect(result.status).toBe("valid");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].headers.Cookie).toBe(header);
  });

  it.each(exports)("normalizes an exported jar before session renewal: %s", async (raw) => {
    const credentials = { apiKey: raw };
    await expect(new MuseWebExecutor()._openThreadPage(credentials, {})).rejects.toThrow("browser boundary");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].headers.Cookie).toBe(header);
    expect(credentials.apiKey).toBe(raw);
  });

  it.each(exports)("accepts exported jars in all existing credential fields: %s", async (raw) => {
    const executor = new MuseWebExecutor();
    for (const credentials of [{ apiKey: raw }, { cookie: raw }, { providerSpecificData: { cookie: raw } }]) {
      expect(await executor.testConnection(credentials)).toBe(true);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves an ordinary Cookie header, including equals signs in values", async () => {
    expect(await new MuseWebExecutor().testConnection({ apiKey: header })).toBe(true);
    expect((await fetchWebIdentity("muse-web", header)).status).toBe("valid");
    expect(fetch.mock.calls[0][1].headers.Cookie).toBe(header);
  });

  it.each([
    '[{"name":"hatch_sess","value":',
    '{"cookies":"not an array"}',
    '{"cookies":[{"name":"hatch_sess"}]}',
    "[]",
  ])("rejects invalid or empty exports before making requests: %s", async (raw) => {
    const result = await fetchWebIdentity("muse-web", raw);
    expect(result.status).toBe("invalid");
    expect(result.error).toMatch(/cookie|JSON/i);
    expect(await new MuseWebExecutor().testConnection({ apiKey: raw })).toBe(false);
    await expect(new MuseWebExecutor()._openThreadPage({ apiKey: raw }, {}))
      .rejects.toThrow(/cookie|JSON/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([[401, "invalid"], [403, "invalid"], [500, "unknown"]])(
    "preserves upstream validation status %s after conversion", async (status, expected) => {
      fetch.mockResolvedValueOnce(new Response("", { status }));
      expect((await fetchWebIdentity("muse-web", exports[0])).status).toBe(expected);
      expect(fetch.mock.calls[0][1].headers.Cookie).toBe(header);
    }
  );

  it("preserves shared session-cookie normalization for existing providers", () => {
    expect(normalizeSessionCookieHeader("bare-token", "sso")).toBe("sso=bare-token");
    expect(normalizeSessionCookieHeader('Cookie: sso=token==', "sso")).toBe("sso=token==");
    expect(normalizeSessionCookieHeader(JSON.stringify([{ name: "sso", value: "token==" }]), "sso"))
      .toBe("sso=token==");
  });
});
