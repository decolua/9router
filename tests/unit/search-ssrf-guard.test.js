import { describe, expect, it } from "vitest";
import { resolveBaseUrl } from "../../open-sse/handlers/search/callers.js";

const CONFIG = { id: "searxng", baseUrl: "https://searxng.example.com" };

describe("search baseUrl SSRF guard", () => {
  it("uses the provider default when the client sends no override", () => {
    expect(resolveBaseUrl(CONFIG, {})).toBe("https://searxng.example.com");
  });

  it.each([
    "https://search.example.net/",
    "http://search.example.net/",
  ])("allows public HTTP(S) client override %s", (baseUrl) => {
    expect(resolveBaseUrl(CONFIG, {
      providerOptions: { baseUrl },
    })).toBe(baseUrl.slice(0, -1));
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
    "ftp://10.0.0.1",
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
