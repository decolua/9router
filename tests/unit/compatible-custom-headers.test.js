import { describe, it, expect } from "vitest";
import {
  normalizeCustomHeaders,
  resolveCustomHeadersForSave,
  applyCustomHeaders,
  applyHeaderList,
  maskCustomHeaders,
  maskCustomHeaderValues,
  toMaskedNode,
  supportsCustomHeaders,
} from "open-sse/utils/customHeaders.js";
import {
  CUSTOM_HEADER_MASK,
  CUSTOM_HEADERS_MAX_COUNT,
  CUSTOM_HEADER_VALUE_MAX_LENGTH,
} from "open-sse/config/customHeaders.js";
import { DefaultExecutor } from "open-sse/executors/default.js";
import openaiCompatNode from "open-sse/handlers/embeddingProviders/openaiCompatNode.js";

const OC = "openai-compatible-chat-abc";
const AC = "anthropic-compatible-abc";

const lowerKeys = (h) => Object.keys(h).map((k) => k.toLowerCase());

describe("normalizeCustomHeaders (save-time validation)", () => {
  it("accepts RFC 7230 token names and trims names/values", () => {
    const { headers, error } = normalizeCustomHeaders([
      { name: " api-key ", value: " {{API_KEY}} " },
      { name: "Ocp-Apim-Subscription-Key", value: "abc" },
      { name: "X-Weird!#$%&'*+.^_`|~", value: "ok" },
    ]);
    expect(error).toBeUndefined();
    expect(headers).toEqual([
      { name: "api-key", value: "{{API_KEY}}" },
      { name: "Ocp-Apim-Subscription-Key", value: "abc" },
      { name: "X-Weird!#$%&'*+.^_`|~", value: "ok" },
    ]);
  });

  it("accepts a plain object and drops blank-name rows", () => {
    expect(normalizeCustomHeaders({ "User-Agent": "claude-cli/1.0" }).headers).toEqual([{ name: "User-Agent", value: "claude-cli/1.0" }]);
    expect(normalizeCustomHeaders([{ name: "  ", value: "x" }]).headers).toEqual([]);
    expect(normalizeCustomHeaders(undefined).headers).toEqual([]);
  });

  it("keeps an empty value (means: remove header)", () => {
    expect(normalizeCustomHeaders([{ name: "Authorization", value: "" }]).headers).toEqual([{ name: "Authorization", value: "" }]);
  });

  it.each([
    ["X Bad", "space"],
    ["X:Bad", "colon"],
    ["X/Bad", "slash"],
    ["Ünï", "unicode"],
    ["X(Bad)", "parens"],
  ])("rejects invalid name %s (%s)", (name) => {
    expect(normalizeCustomHeaders([{ name, value: "v" }]).error).toMatch(/Invalid header name/);
  });

  it.each([
    ["a\r\nX-Injected: 1", "CRLF"],
    ["a\nb", "LF"],
    ["a\rb", "CR"],
    ["a\0b", "NUL"],
    ["\u2022secret", "non-Latin-1"],
  ])("rejects value with %s", (value) => {
    expect(normalizeCustomHeaders([{ name: "X-A", value }]).error).toMatch(/Invalid value/);
  });

  it("rejects non-string values", () => {
    expect(normalizeCustomHeaders([{ name: "X-A", value: 5 }]).error).toMatch(/Invalid value/);
  });

  it.each(["Host", "CONTENT-LENGTH", "Transfer-Encoding", "connection", "Upgrade", "TE", "Trailer",
    "Keep-Alive", "Proxy-Authorization", "Proxy-Connection", "Content-Type", "Expect"])(
    "rejects denylisted %s case-insensitively", (name) => {
      expect(normalizeCustomHeaders([{ name, value: "x" }]).error).toMatch(/cannot be set/);
    });

  it("allows overriding User-Agent, Authorization, x-api-key, anthropic-version, Accept", () => {
    const { headers, error } = normalizeCustomHeaders(
      ["User-Agent", "Authorization", "x-api-key", "anthropic-version", "Accept"].map((name) => ({ name, value: "v" })),
    );
    expect(error).toBeUndefined();
    expect(headers).toHaveLength(5);
  });

  it("rejects case-insensitive duplicates", () => {
    expect(normalizeCustomHeaders([{ name: "X-A", value: "1" }, { name: "x-a", value: "2" }]).error).toMatch(/Duplicate/);
  });

  it("enforces count and value-length limits", () => {
    const many = Array.from({ length: CUSTOM_HEADERS_MAX_COUNT + 1 }, (_, i) => ({ name: `X-H${i}`, value: "v" }));
    expect(normalizeCustomHeaders(many).error).toMatch(/Too many/);
    expect(normalizeCustomHeaders(many.slice(0, CUSTOM_HEADERS_MAX_COUNT)).error).toBeUndefined();
    expect(normalizeCustomHeaders([{ name: "X-A", value: "a".repeat(CUSTOM_HEADER_VALUE_MAX_LENGTH + 1) }]).error).toMatch(/too long/);
    expect(normalizeCustomHeaders([{ name: "X-A", value: "a".repeat(CUSTOM_HEADER_VALUE_MAX_LENGTH) }]).error).toBeUndefined();
  });

  it("rejects non-list input", () => {
    expect(normalizeCustomHeaders("X-A: b").error).toMatch(/must be a list/);
  });
});

describe("masking + edit keep-unchanged rule", () => {
  const stored = [
    { name: "api-key", value: "{{API_KEY}}" },
    { name: "X-Gateway-Token", value: "gw-secret-123" },
    { name: "Authorization", value: "" },
  ];

  it("masks every non-empty value, keeps names and empty values", () => {
    expect(maskCustomHeaders(stored)).toEqual([
      { name: "api-key", value: CUSTOM_HEADER_MASK },
      { name: "X-Gateway-Token", value: CUSTOM_HEADER_MASK },
      { name: "Authorization", value: "" },
    ]);
    const node = toMaskedNode({ id: OC, name: "n", customHeaders: stored });
    expect(JSON.stringify(node)).not.toContain("gw-secret-123");
    expect(toMaskedNode({ id: "x" })).toEqual({ id: "x" });
  });

  it("mask sentinel keeps the stored value (case-insensitive name match)", () => {
    const { headers } = resolveCustomHeadersForSave([
      { name: "x-gateway-token", value: CUSTOM_HEADER_MASK },
      { name: "api-key", value: "new-value" },
    ], stored);
    expect(headers).toEqual([
      { name: "x-gateway-token", value: "gw-secret-123" },
      { name: "api-key", value: "new-value" },
    ]);
  });

  it("omitted field keeps the whole stored list; empty list clears it", () => {
    expect(resolveCustomHeadersForSave(undefined, stored).headers).toBe(stored);
    expect(resolveCustomHeadersForSave([], stored).headers).toEqual([]);
  });

  it("mask for a name with no stored value is rejected (never sent upstream as-is)", () => {
    expect(resolveCustomHeadersForSave([{ name: "X-New", value: CUSTOM_HEADER_MASK }], stored).error).toMatch(/Re-enter/);
    // the raw sentinel itself is not a valid value either
    expect(normalizeCustomHeaders([{ name: "X-New", value: CUSTOM_HEADER_MASK }]).error).toMatch(/Invalid value/);
  });

  it("maskCustomHeaderValues hides custom header values in a log copy only", () => {
    const outbound = { "API-KEY": "sk-1", Accept: "x" };
    const logged = maskCustomHeaderValues(outbound, stored);
    expect(logged).toEqual({ "API-KEY": CUSTOM_HEADER_MASK, Accept: "x" });
    expect(outbound["API-KEY"]).toBe("sk-1");
  });
});

describe("applyCustomHeaders (apply-time semantics)", () => {
  const creds = { apiKey: "sk-test-123" };

  it("replaces existing headers case-insensitively without duplicates", () => {
    const h = applyCustomHeaders({ "user-agent": "node", Authorization: "Bearer x" }, [
      { name: "User-Agent", value: "claude-cli/2.0 (external, cli)" },
      { name: "authorization", value: "Token y" },
    ], creds, OC);
    expect(h).toEqual({ "User-Agent": "claude-cli/2.0 (external, cli)", authorization: "Token y" });
    expect(new Set(lowerKeys(h)).size).toBe(Object.keys(h).length);
  });

  it("substitutes {{API_KEY}} (every occurrence)", () => {
    const h = applyCustomHeaders({}, [{ name: "api-key", value: "{{API_KEY}}" }, { name: "X-Both", value: "{{API_KEY}}:{{API_KEY}}" }], creds, AC);
    expect(h["api-key"]).toBe("sk-test-123");
    expect(h["X-Both"]).toBe("sk-test-123:sk-test-123");
  });

  it("empty value removes the header regardless of case", () => {
    const h = applyCustomHeaders({ authorization: "Bearer a", AUTHORIZATION: "Bearer b", Accept: "x" }, [{ name: "Authorization", value: "" }], creds, OC);
    expect(h).toEqual({ Accept: "x" });
  });

  it("skips denylisted / invalid entries even if they are in storage", () => {
    const h = applyCustomHeaders({ "Content-Type": "application/json" }, [
      { name: "Host", value: "evil.example" },
      { name: "content-length", value: "0" },
      { name: "Content-Type", value: "text/plain" },
      { name: "Transfer-Encoding", value: "chunked" },
      { name: "X-Bad", value: "a\r\nX-Injected: 1" },
      { name: "Bad Name", value: "v" },
      { name: "X-Ok", value: "1" },
    ], creds, OC);
    expect(h).toEqual({ "Content-Type": "application/json", "X-Ok": "1" });
  });

  it("drops a value whose substituted API key contains CR/LF", () => {
    const h = applyCustomHeaders({}, [{ name: "api-key", value: "{{API_KEY}}" }], { apiKey: "a\r\nX-Injected: 1" }, OC);
    expect(h).toEqual({});
  });

  it("is a no-op for built-in / OAuth providers and custom-embedding nodes", () => {
    for (const provider of ["openai", "claude", "codex", "custom-embedding-x", undefined]) {
      expect(applyCustomHeaders({ A: "1" }, [{ name: "X-A", value: "v" }], creds, provider)).toEqual({ A: "1" });
    }
    expect(supportsCustomHeaders(OC)).toBe(true);
    expect(supportsCustomHeaders(AC)).toBe(true);
  });

  it("applyHeaderList ignores non-array input", () => {
    expect(applyHeaderList({ A: "1" }, null, creds)).toEqual({ A: "1" });
    expect(applyHeaderList({ A: "1" }, { "X-A": "v" }, creds)).toEqual({ A: "1" });
  });
});

describe("DefaultExecutor.buildHeaders with node custom headers", () => {
  it("openai-compatible: Azure APIM-style api-key replaces Authorization; UA overridden", () => {
    const ex = new DefaultExecutor(OC);
    const h = ex.buildHeaders({
      apiKey: "sk-azure",
      providerSpecificData: { baseUrl: "https://gw.example/v1" },
      customHeaders: [
        { name: "Authorization", value: "" },
        { name: "api-key", value: "{{API_KEY}}" },
        { name: "user-agent", value: "claude-cli/2.0" },
        { name: "Host", value: "evil.example" },
      ],
    }, true, "https://gw.example/v1/chat/completions", "gpt-4o");
    expect(lowerKeys(h)).not.toContain("authorization");
    expect(lowerKeys(h)).not.toContain("host");
    expect(h["api-key"]).toBe("sk-azure");
    expect(h["user-agent"]).toBe("claude-cli/2.0");
    expect(h["Content-Type"]).toBe("application/json");
    expect(h.Accept).toBe("text/event-stream");
  });

  it("anthropic-compatible: user value wins over x-api-key, Bearer and anthropic-version", () => {
    const ex = new DefaultExecutor(AC);
    const base = { apiKey: "sk-ant", providerSpecificData: { baseUrl: "https://gw.example/v1" } };
    const without = ex.buildHeaders(base, false, undefined, "glm-4.6");
    expect(without["x-api-key"]).toBe("sk-ant");
    expect(without.Authorization).toBe("Bearer sk-ant");

    const h = ex.buildHeaders({
      ...base,
      customHeaders: [
        { name: "X-API-KEY", value: "" },
        { name: "authorization", value: "Bearer {{API_KEY}}-gw" },
        { name: "Anthropic-Version", value: "2024-01-01" },
        { name: "HTTP-Referer", value: "https://example.com" },
      ],
    }, false, undefined, "glm-4.6");
    expect(lowerKeys(h)).not.toContain("x-api-key");
    expect(h.authorization).toBe("Bearer sk-ant-gw");
    expect(lowerKeys(h).filter((k) => k === "authorization")).toHaveLength(1);
    expect(h["Anthropic-Version"]).toBe("2024-01-01");
    expect(lowerKeys(h).filter((k) => k === "anthropic-version")).toHaveLength(1);
    expect(h["HTTP-Referer"]).toBe("https://example.com");
  });

  it("built-in provider (openai) ignores customHeaders even if present in credentials", () => {
    const ex = new DefaultExecutor("openai");
    const creds = { apiKey: "sk-openai" };
    const plain = ex.buildHeaders(creds, true);
    const withCustom = ex.buildHeaders({ ...creds, customHeaders: [{ name: "Authorization", value: "" }, { name: "X-Evil", value: "1" }] }, true);
    expect(withCustom).toEqual(plain);
    expect(withCustom.Authorization).toBe("Bearer sk-openai");
  });

  it("openai-compatible embeddings adapter applies node headers", () => {
    const h = openaiCompatNode.buildHeaders({ apiKey: "k", customHeaders: [{ name: "Authorization", value: "" }, { name: "api-key", value: "{{API_KEY}}" }] }, { provider: OC });
    expect(h).toEqual({ "Content-Type": "application/json", "api-key": "k" });
    const embed = openaiCompatNode.buildHeaders({ apiKey: "k", customHeaders: [{ name: "X-A", value: "1" }] }, { provider: "custom-embedding-x" });
    expect(embed["X-A"]).toBeUndefined();
  });
});
