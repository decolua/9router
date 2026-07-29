import crypto from "node:crypto";
import { describe, it, expect } from "vitest";
import { encrypt, decrypt, isEncrypted, tryDecrypt } from "@/lib/crypto/envelope.js";

function key32(byte = 1) {
  return Buffer.alloc(32, byte);
}

describe("envelope crypto", () => {
  it("round-trips plaintext", () => {
    const key = key32(7);
    const plain = '{"accessToken":"secret"}';
    const env = encrypt(plain, key);
    expect(isEncrypted(env)).toBe(true);
    expect(decrypt(env, key)).toBe(plain);
  });

  it("uses unique nonces per encryption", () => {
    const key = key32(3);
    const a = encrypt("same", key);
    const b = encrypt("same", key);
    expect(a).not.toBe(b);
    expect(decrypt(a, key)).toBe("same");
    expect(decrypt(b, key)).toBe("same");
  });

  it("rejects wrong key", () => {
    const env = encrypt("x", key32(1));
    expect(() => decrypt(env, key32(2))).toThrow(/decryption failed/i);
  });

  it("rejects tampered ciphertext", () => {
    const env = encrypt("x", key32(1));
    const [, , ctB64] = env.slice("enc:v1:".length).split(":");
    const ct = Buffer.from(ctB64, "base64");
    ct[0] ^= 0xff;
    const tampered = `enc:v1:${env.slice("enc:v1:".length).split(":")[0]}:${env.slice("enc:v1:".length).split(":")[1]}:${ct.toString("base64")}`;
    expect(() => decrypt(tampered, key32(1))).toThrow(/decryption failed/i);
  });

  it("tryDecrypt leaves plaintext unchanged", () => {
    const key = key32(9);
    expect(tryDecrypt('{"a":1}', key)).toBe('{"a":1}');
    const env = encrypt('{"a":1}', key);
    expect(tryDecrypt(env, key)).toBe('{"a":1}');
  });

  it("passes through nullish values", () => {
    const key = key32(4);
    expect(encrypt(null, key)).toBe(null);
    expect(decrypt(null, key)).toBe(null);
  });

  it("fingerprint domain is independent of envelope format", () => {
    const env = encrypt("test", key32(5));
    expect(env.startsWith("enc:v1:")).toBe(true);
    const parts = env.slice("enc:v1:".length).split(":");
    expect(parts).toHaveLength(3);
    expect(Buffer.from(parts[0], "base64").length).toBe(12);
    expect(Buffer.from(parts[1], "base64").length).toBe(16);
  });
});
