import { afterEach, describe, expect, it, vi } from "vitest";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("GLM reset-card mutations through the real proxy transport", () => {
  it.each(["tls", "proxy"])("never falls back and resends after a %s failure", async (failure) => {
    vi.resetModules();
    for (const key of ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy"]) {
      vi.stubEnv(key, "");
    }
    if (failure === "proxy") vi.stubEnv("HTTPS_PROXY", "http://127.0.0.1:9");
    const wireFetch = vi.fn(async () => {
      throw Object.assign(new Error("request may already have reached upstream"), {
        code: failure === "tls" ? "SELF_SIGNED_CERT_IN_CHAIN" : "ECONNRESET",
      });
    });
    globalThis.fetch = wireFetch;
    const { redeemGlmResetCard } = await import("../../open-sse/services/usage/glm.js");
    const glm = await redeemGlmResetCard("key", { recordId: 1, type: "WEEK" });
    expect(glm).toMatchObject({ ok: false, uncertain: true });
    expect(wireFetch).toHaveBeenCalledTimes(1);

  });
});
