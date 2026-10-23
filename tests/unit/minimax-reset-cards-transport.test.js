import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.doUnmock("undici");
  vi.resetModules();
});

describe("reset-card mutations through the real proxy transport", () => {
  it.each(["SELF_SIGNED_CERT_IN_CHAIN", "UND_ERR_SOCKET", "ECONNRESET", "EPIPE", "UND_ERR_HEADERS_TIMEOUT", "proxy"])("never falls back and resends after %s", async (code) => {
    vi.resetModules();
    for (const key of ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy"]) vi.stubEnv(key, "");
    vi.stubEnv("FETCH_FRESH_RETRY", "1");
    if (code === "proxy") vi.stubEnv("HTTPS_PROXY", "http://127.0.0.1:9");
    const wireFetch = vi.fn(async () => {
      throw Object.assign(new Error("request may already have reached upstream"), { cause: { code: code === "proxy" ? "ECONNRESET" : code } });
    });
    vi.doMock("undici", async () => ({ ...await vi.importActual("undici"), fetch: wireFetch }));
    const { redeemMiniMaxResetCard } = await import("../../open-sse/services/minimaxCodeUsage.js");
    const result = await redeemMiniMaxResetCard("token", "minimax-code-global", {
      cardId: "card-1", source_type: "mcode_signin", out_biz_no: "stable-identity", expiresAt: "2099-01-01T00:00:00Z",
    });
    expect(result).toMatchObject({ ok: false, uncertain: true });
    expect(wireFetch).toHaveBeenCalledTimes(1);
  });
});
