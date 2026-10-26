import { describe, it, expect } from "vitest";
import { getWebLoginConfig } from "../../open-sse/services/webLoginConfig.js";

const { validateToken } = getWebLoginConfig("deepseek-web");
const REAL = "x".repeat(40); // obviously-fake token body

describe("deepseek-web login token validation", () => {
  it("rejects the anonymous-visitor placeholder DeepSeek writes before login", () => {
    expect(validateToken('{"value":null,"__version":"0"}')).toBe(false);
    expect(validateToken('{"value":"","__version":"0"}')).toBe(false);
  });

  it("rejects a JSON wrapper whose value is not a long-enough string", () => {
    expect(validateToken(JSON.stringify({ value: "short", __version: "0" }))).toBe(false);
    expect(validateToken(JSON.stringify({ __version: "0" }))).toBe(false);
  });

  it("accepts the wrapped token once logged in", () => {
    expect(validateToken(JSON.stringify({ value: REAL, __version: "0" }))).toBe(true);
  });

  it("accepts a raw (unwrapped) token and rejects empty input", () => {
    expect(validateToken(REAL)).toBe(true);
    expect(validateToken("")).toBe(false);
    expect(validateToken(null)).toBe(false);
  });
});
