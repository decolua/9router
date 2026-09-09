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
