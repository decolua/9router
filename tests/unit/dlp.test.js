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
