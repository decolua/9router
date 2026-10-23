import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.doUnmock("undici");
  vi.resetModules();
});

describe("GLM reset-card mutations through the real proxy transport", () => {
  it.each(["SELF_SIGNED_CERT_IN_CHAIN", "UND_ERR_SOCKET", "ECONNRESET", "EPIPE", "UND_ERR_HEADERS_TIMEOUT", "proxy"])("never falls back and resends after %s", async (code) => {
    vi.resetModules();
    for (const key of ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy"]) vi.stubEnv(key, "");
    vi.stubEnv("FETCH_FRESH_RETRY", "1");
    if (code === "proxy") vi.stubEnv("HTTPS_PROXY", "http://127.0.0.1:9");
    const wireFetch = vi.fn(async () => {
      throw Object.assign(new Error("request may already have reached upstream"), { cause: { code: code === "proxy" ? "ECONNRESET" : code } });
    });
    vi.doMock("undici", async () => ({ ...await vi.importActual("undici"), fetch: wireFetch }));
    const { redeemGlmResetCard } = await import("../../open-sse/services/usage/glm.js");
    const result = await redeemGlmResetCard("key", { recordId: 1, type: "WEEK" });
    expect(result).toMatchObject({ ok: false, uncertain: true });
    expect(wireFetch).toHaveBeenCalledTimes(1);
  });
});
