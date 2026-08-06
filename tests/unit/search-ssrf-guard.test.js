import { describe, expect, it } from "vitest";
import { resolveBaseUrl } from "../../open-sse/handlers/search/callers.js";

const CONFIG = { id: "searxng", baseUrl: "https://searxng.example.com" };

describe("search baseUrl SSRF guard", () => {
  it("uses the provider default when the client sends no override", () => {
    expect(resolveBaseUrl(CONFIG, {})).toBe("https://searxng.example.com");
  });

  it("allows public HTTP(S) client overrides", () => {
    expect(resolveBaseUrl(CONFIG, {
      providerOptions: { baseUrl: "https://search.example.net/" },
    })).toBe("https://search.example.net");
  });

  it.each([
    "http://127.0.0.1:18999",
    "http://10.0.0.1",
    "http://172.16.0.1",
    "http://192.168.1.1",
    "http://169.254.169.254/latest/meta-data",
    "http://localhost:8080",
    "file:///etc/passwd",
    "gopher://127.0.0.1:70",
  ])("rejects unsafe client override %s", (baseUrl) => {
    expect(() => resolveBaseUrl(CONFIG, {
      providerOptions: { baseUrl },
    })).toThrow();
  });

  it("keeps admin-configured private search endpoints usable", () => {
    expect(resolveBaseUrl(CONFIG, {
      providerSpecificData: { baseUrl: "http://127.0.0.1:8080/" },
    })).toBe("http://127.0.0.1:8080");
  });
});
