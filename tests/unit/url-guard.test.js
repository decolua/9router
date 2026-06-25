import { describe, expect, it, vi, afterEach } from "vitest";
import { guardedFetch, isPrivateIpAddress, validatePublicUrl, UrlGuardError } from "../../src/lib/security/urlGuard.js";

const publicLookup = async (hostname) => {
  if (hostname === "private.example") return [{ address: "10.0.0.7", family: 4 }];
  return [{ address: "93.184.216.34", family: 4 }];
};

describe("SSRF URL guard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "http://[::1]:8080",
    "http://10.0.0.1",
    "http://172.16.0.1",
    "http://192.168.1.1",
    "http://169.254.169.254/latest/meta-data",
    "file:///etc/passwd",
  ])("blocks private or invalid URL %s", async (url) => {
    await expect(validatePublicUrl(url, {
      protocols: ["http:", "https:"],
      lookup: publicLookup,
    })).rejects.toBeInstanceOf(UrlGuardError);
  });

  it("blocks hostnames that resolve to private addresses", async () => {
    await expect(validatePublicUrl("https://private.example/v1", {
      lookup: publicLookup,
    })).rejects.toMatchObject({ code: "DNS_PRIVATE_IP" });
  });

  it("allows public HTTPS URLs", async () => {
    const parsed = await validatePublicUrl("https://api.openai.com/v1/models", {
      lookup: publicLookup,
    });
    expect(parsed.hostname).toBe("api.openai.com");
  });

  it("blocks redirect-to-private targets", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 302,
      headers: { get: (name) => name === "location" ? "https://127.0.0.1/admin" : null },
    });

    await expect(guardedFetch("https://api.openai.com/v1/models", {}, {
      lookup: publicLookup,
    })).rejects.toMatchObject({ code: "PRIVATE_IP" });
  });

  it("enforces its timeout even when caller passes a signal", async () => {
    global.fetch = vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        reject(err);
      });
    }));

    const upstream = new AbortController();
    await expect(guardedFetch("https://api.openai.com/v1/models", {
      signal: upstream.signal,
    }, {
      lookup: publicLookup,
      timeoutMs: 1,
    })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("classifies reserved IP ranges as private", () => {
    expect(isPrivateIpAddress("10.1.2.3")).toBe(true);
    expect(isPrivateIpAddress("172.31.255.255")).toBe(true);
    expect(isPrivateIpAddress("192.168.0.1")).toBe(true);
    expect(isPrivateIpAddress("203.0.113.10")).toBe(true);
    expect(isPrivateIpAddress("93.184.216.34")).toBe(false);
  });
});
