import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getMasterKey,
  isMasterKeyConfigured,
  getKeyFingerprint,
  _resetCacheForTests,
} from "@/lib/crypto/masterKey.js";

const VALID_KEY_B64 = Buffer.alloc(32, 42).toString("base64");

describe("master key loader", () => {
  const prev = process.env.MASTER_KEY;

  beforeEach(() => {
    _resetCacheForTests();
    delete process.env.MASTER_KEY;
  });

  afterEach(() => {
    _resetCacheForTests();
    if (prev === undefined) delete process.env.MASTER_KEY;
    else process.env.MASTER_KEY = prev;
  });

  it("isMasterKeyConfigured is false when unset", () => {
    expect(isMasterKeyConfigured()).toBe(false);
  });

  it("loads 32-byte key from base64 env", () => {
    process.env.MASTER_KEY = VALID_KEY_B64;
    expect(isMasterKeyConfigured()).toBe(true);
    const key = getMasterKey();
    expect(Buffer.isBuffer(key)).toBe(true);
    expect(key.length).toBe(32);
    expect(key[0]).toBe(42);
  });

  it("rejects invalid base64", () => {
    process.env.MASTER_KEY = "%%%not-base64%%%";
    expect(() => getMasterKey()).toThrow(/not valid base64|must decode to 32 bytes/i);
  });

  it("rejects wrong length", () => {
    process.env.MASTER_KEY = Buffer.alloc(16, 1).toString("base64");
    expect(() => getMasterKey()).toThrow(/must decode to 32 bytes/i);
  });

  it("rejects all-zero key", () => {
    process.env.MASTER_KEY = Buffer.alloc(32, 0).toString("base64");
    expect(() => getMasterKey()).toThrow(/all zeroes/i);
  });

  it("fingerprint is stable for the same key", () => {
    process.env.MASTER_KEY = VALID_KEY_B64;
    const a = getKeyFingerprint();
    _resetCacheForTests();
    process.env.MASTER_KEY = VALID_KEY_B64;
    const b = getKeyFingerprint();
    expect(a).toBe(b);
    expect(a).toHaveLength(16);
  });

  it("fingerprint changes when key changes", () => {
    process.env.MASTER_KEY = VALID_KEY_B64;
    const a = getKeyFingerprint();
    _resetCacheForTests();
    process.env.MASTER_KEY = Buffer.alloc(32, 99).toString("base64");
    const b = getKeyFingerprint();
    expect(a).not.toBe(b);
  });
});
