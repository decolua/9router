import { describe, it, expect } from "vitest";
import {
  PII_TYPES,
  PATTERN_BY_ID,
  DEFAULT_TYPES,
  isValidCpf,
  isValidCnpj,
  luhnValid,
  isValidIpv4,
} from "../open-sse/dlp/patterns.js";
import {
  getPseudonym,
  getPseudonymForCustom,
  getMapping,
  clearMapping,
  normalizeRealKey,
  REDACT_LABEL,
} from "../open-sse/dlp/pseudonyms.js";
import {
  maskText,
  maskSensitiveData,
  testMask,
  wildcardToRegex,
} from "../open-sse/dlp/index.js";

const DIGITS = (s) => s.replace(/\D/g, "");

describe("patterns", () => {
  it("exports all 8 built-in types and DEFAULT_TYPES", () => {
    expect(PII_TYPES.map((t) => t.id)).toEqual([
      "email", "phone", "cpf", "cnpj", "cep", "creditCard", "ip", "apiKey",
    ]);
    expect(DEFAULT_TYPES).toEqual(["email", "phone", "cpf", "cnpj", "creditCard", "ip", "apiKey"]);
    for (const t of PII_TYPES) {
      expect(PATTERN_BY_ID[t.id]).toBe(t);
      expect(t.regex).toBeInstanceOf(RegExp);
      expect(t.regex.global).toBe(true);
    }
  });

  it("cpf validation accepts a known-valid CPF and rejects invalid ones", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("111.111.111-11")).toBe(false);   // repeated digits
    expect(isValidCpf("123.456.789-00")).toBe(false);   // bad check digits
    expect(isValidCpf("12345678900")).toBe(false);
  });

  it("cnpj validation accepts a known-valid CNPJ and rejects invalid ones", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11.222.333/0001-00")).toBe(false);
    expect(isValidCnpj("00000000000000")).toBe(false);  // repeated digits
  });

  it("luhnValid accepts a known card and rejects a bad one", () => {
    expect(luhnValid("4111 1111 1111 1111")).toBe(true);
    expect(luhnValid("4111 1111 1111 1112")).toBe(false);
    expect(luhnValid("1234")).toBe(false);              // too short
  });

  it("isValidIpv4 rejects out-of-range octets", () => {
    expect(isValidIpv4("192.168.0.1")).toBe(true);
    expect(isValidIpv4("256.1.1.1")).toBe(false);
    expect(isValidIpv4("1.2.3")).toBe(false);
  });

  it("regexes are global and anchored enough for realistic samples", () => {
    const email = PATTERN_BY_ID.email.regex;
    const sample = "mail me at john.doe@example.com or jane@test.co.uk now";
    const hits = sample.match(email);
    expect(hits).toEqual(["john.doe@example.com", "jane@test.co.uk"]);

    const cep = PATTERN_BY_ID.cep.regex;
    expect("cep 12345-678 end".match(cep)).toEqual(["12345-678"]);
    expect("number 12345678 no dash".match(cep)).toBeNull();
  });
});

describe("pseudonyms", () => {
  beforeEach(() => clearMapping());

  it("returns the same fake for the same real value (consistency)", () => {
    const a = getPseudonym("email", "john@example.com");
    const b = getPseudonym("email", "john@example.com");
    expect(a).toBe(b);
    expect(a).not.toBe("john@example.com");
    expect(a.endsWith("@example.com")).toBe(true);
  });

  it("produces valid CPF/CNPJ/card/IP fakes", () => {
    expect(isValidCpf(DIGITS(getPseudonym("cpf", "529.982.247-25")))).toBe(true);
    expect(isValidCnpj(DIGITS(getPseudonym("cnpj", "11.222.333/0001-81")))).toBe(true);
    expect(luhnValid(getPseudonym("creditCard", "4111 1111 1111 1111"))).toBe(true);
    const ip = getPseudonym("ip", "200.150.10.10");
    expect(ip.startsWith("10.")).toBe(true);
    expect(ip).not.toBe("200.150.10.10");
  });

  it("normalizes digit-keyed types so formats map to the same fake", () => {
    const f1 = getPseudonym("cpf", "123.456.789-00");
    const f2 = getPseudonym("cpf", "12345678900"); // same digits, different format
    expect(f1).toBe(f2);
  });

  it("does NOT normalize email (case/format sensitive is fine at v1)", () => {
    expect(normalizeRealKey("email", "John@Example.com")).toBe("John@Example.com");
  });

  it("exposes mapping and clears it", () => {
    getPseudonym("email", "a@b.co");
    getPseudonym("email", "c@d.co");
    const { entries, count } = getMapping();
    expect(count).toBe(2);
    expect(entries.map((e) => e.real).sort()).toEqual(["a@b.co", "c@d.co"]);
    expect(entries.every((e) => typeof e.fake === "string" && e.type === "email")).toBe(true);
    expect(clearMapping()).toBe(2);
    expect(getMapping().count).toBe(0);
  });

  it("caps the table at 10_000 entries (evicts oldest)", () => {
    for (let i = 0; i < 10_000 + 50; i++) getPseudonym("email", `u${i}@example.com`);
    expect(getMapping().count).toBe(10_000);
    const reals = getMapping().entries.map((e) => e.real);
    expect(reals).not.toContain("u0@example.com"); // oldest evicted
    expect(reals).toContain("u10049@example.com");
  });

  it("custom patterns get a deterministic [PII-xxxxxx] placeholder", () => {
    const p1 = getPseudonymForCustom("EMP-1234");
    const p2 = getPseudonymForCustom("EMP-1234");
    expect(p1).toBe(p2);
    expect(p1).toMatch(/^\[PII-[0-9a-f]{6}\]$/);
    expect(REDACT_LABEL).toBe("[PII-REDACTED]");
  });
});

describe("dlp engine", () => {
  it("redacts emails and CPFs with the fixed label", () => {
    const { text, matched } = maskText("mail me@x.co my CPF is 529.982.247-25 ok", {
      mode: "redact",
      types: ["email", "cpf"],
    });
    expect(text).toBe("mail [PII-REDACTED] my CPF is [PII-REDACTED] ok");
    expect(matched).toBe(2);
  });

  it("pseudonymizes consistently across calls", () => {
    const a = maskText("hi john@example.com", { mode: "pseudo", types: ["email"] });
    const b = maskText("hi john@example.com", { mode: "pseudo", types: ["email"] });
    expect(a.text).toBe(b.text);
    expect(a.text).not.toContain("john@example.com");
    expect(a.text).toMatch(/user[0-9a-f]{6}@example\.com/);
  });

  it("does not double-mask pseudonyms (tokens are inert)", () => {
    const { text } = maskText("529.982.247-25", { mode: "redact", types: ["cpf", "phone"] });
    expect(text).toBe("[PII-REDACTED]");
  });

  it("skips structural keys and base64-looking strings", () => {
    const body = {
      model: "cc/claude-opus-5",
      id: "chatcmpl-12345",
      messages: [
        { role: "user", content: "email a@b.co", name: "a@b.co" },
        { role: "tool", content: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" },
      ],
    };
    const stats = maskSensitiveData(body, { mode: "redact", types: ["email"] });
    expect(body.model).toBe("cc/claude-opus-5");
    expect(body.id).toBe("chatcmpl-12345");
    expect(body.messages[0].content).toBe("email [PII-REDACTED]");
    expect(body.messages[0].name).toBe("a@b.co"); // denylisted key
    expect(body.messages[1].content).toBe(body.messages[1].content); // base64 untouched
    expect(stats.matched).toBe(1);
  });

  it("handles custom wildcard patterns across values", () => {
    const { text } = maskText("connect to db-01.internal", {
      mode: "redact",
      types: [],
      customPatterns: [{ id: "c1", name: "db hosts", type: "wildcard", pattern: "db-*.internal", flags: "", enabled: true }],
    });
    expect(text).toBe("connect to [PII-REDACTED]");
  });

  it("handles custom regex patterns with flags", () => {
    const { text } = maskText("EMP-1234 and emp-9999", {
      mode: "redact",
      types: [],
      customPatterns: [{ id: "c2", name: "employee id", type: "regex", pattern: "EMP-\\d{4}", flags: "gi", enabled: true }],
    });
    expect(text).toBe("[PII-REDACTED] and [PII-REDACTED]");
  });

  it("ignores disabled custom patterns and invalid regexes (fail-open)", () => {
    const cfg = {
      mode: "redact",
      types: [],
      customPatterns: [
        { id: "off", name: "off", type: "regex", pattern: "X+", flags: "", enabled: false },
        { id: "bad", name: "bad", type: "regex", pattern: "([unclosed", flags: "", enabled: true },
      ],
    };
    const { text } = maskText("XXX", cfg);
    expect(text).toBe("XXX");
  });

  it("maskSensitiveData fails open on weird bodies", () => {
    expect(maskSensitiveData(null, { enabled: true })).toBeNull();
    expect(maskSensitiveData({}, { enabled: true })).toBeNull();
    expect(() => maskSensitiveData({ messages: [{ content: "a@b.co" }] }, { enabled: false })).not.toThrow();
  });

  it("testMask validates and previews regex and wildcard", () => {
    const r = testMask({ type: "regex", pattern: "\\d{4}", flags: "g", sampleText: "ab 1234 cd" });
    expect(r.valid).toBe(true);
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0]).toMatchObject({ value: "1234", index: 3, length: 4 });
    expect(r.preview).toBe("ab [PII-REDACTED] cd");

    const w = testMask({ type: "wildcard", pattern: "*@acme.internal", flags: "", sampleText: "bob@acme.internal" });
    expect(w.valid).toBe(true);
    expect(w.matches).toHaveLength(1);
    expect(w.preview).toBe("[PII-REDACTED]");

    const bad = testMask({ type: "regex", pattern: "([", flags: "", sampleText: "x" });
    expect(bad.valid).toBe(false);
    expect(bad.error).toBeTruthy();
  });

  it("wildcardToRegex escapes metacharacters", () => {
    expect(wildcardToRegex("a*b")).toBe("a.*b");
    expect(wildcardToRegex("a?b")).toBe("a.b");
    expect(wildcardToRegex("x+y")).toBe("x\\+y");
  });
});
