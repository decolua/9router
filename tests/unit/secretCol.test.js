import { describe, expect, it } from "vitest";
import { encryptSecretJson, decryptSecretJson } from "../../src/lib/db/helpers/secretCol.js";

describe("secretCol", () => {
  it("round-trips a JSON value through encryption", () => {
    const value = { apiKey: "sk-test-123", refreshToken: "rt-abc", nested: { n: 1 } };
    const stored = encryptSecretJson(value);
    expect(typeof stored).toBe("string");
    expect(stored.startsWith("enc1:")).toBe(true);
    expect(stored).not.toContain("sk-test-123");
    expect(decryptSecretJson(stored)).toEqual(value);
  });

  it("reads legacy plaintext JSON without the enc1: prefix", () => {
    const value = { apiKey: "legacy-key" };
    const legacy = JSON.stringify(value);
    expect(decryptSecretJson(legacy)).toEqual(value);
  });

  it("returns the fallback for null/invalid input", () => {
    expect(decryptSecretJson(null, { a: 1 })).toEqual({ a: 1 });
    expect(decryptSecretJson("not json", { a: 1 })).toEqual({ a: 1 });
    expect(decryptSecretJson("enc1:garbage", { a: 1 })).toEqual({ a: 1 });
  });
});
