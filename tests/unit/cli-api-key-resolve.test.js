import { beforeEach, describe, expect, it, vi } from "vitest";

const getApiKeys = vi.fn();
let dbDown = false;
vi.mock("@/lib/db/index.js", () => ({
  getApiKeys: async (...args) => {
    if (dbDown) throw new Error("db down");
    return getApiKeys(...args);
  },
}));

const { resolveCliApiKey, CLI_PLACEHOLDER_API_KEY } = await import("../../src/shared/utils/cliApiKey.js");
const { resolveCliApiKeyForWrite } = await import("../../src/lib/cliApiKey.js");

const keys = [{ key: "sk-real-1" }, { key: "sk-real-2" }];

describe("resolveCliApiKey", () => {
  it("keeps an explicitly selected key", () => {
    expect(resolveCliApiKey("sk-real-2", keys)).toBe("sk-real-2");
  });

  it("falls back to the first dashboard key the dropdown displays when the form is empty", () => {
    expect(resolveCliApiKey("", keys)).toBe("sk-real-1");
    expect(resolveCliApiKey("   ", keys, { cloudEnabled: true })).toBe("sk-real-1");
    expect(resolveCliApiKey(null, keys)).toBe("sk-real-1");
  });

  it("replaces a stale placeholder with a real key", () => {
    expect(resolveCliApiKey(CLI_PLACEHOLDER_API_KEY, keys)).toBe("sk-real-1");
  });

  it("skips inactive dashboard keys", () => {
    expect(resolveCliApiKey("", [{ key: "sk-off", isActive: false }, { key: "sk-on" }])).toBe("sk-on");
  });

  it("uses the placeholder locally and the fallback on cloud only when no dashboard key exists", () => {
    expect(resolveCliApiKey("", [])).toBe(CLI_PLACEHOLDER_API_KEY);
    expect(resolveCliApiKey("", [], { cloudEnabled: true, fallback: "<API_KEY_FROM_DASHBOARD>" })).toBe("<API_KEY_FROM_DASHBOARD>");
    expect(resolveCliApiKey("", [], { cloudEnabled: true })).toBeNull();
  });
});

describe("resolveCliApiKeyForWrite", () => {
  beforeEach(() => {
    getApiKeys.mockReset();
    dbDown = false;
  });

  it("writes the client key when one is given", async () => {
    getApiKeys.mockResolvedValue(keys);
    expect(await resolveCliApiKeyForWrite("sk-real-2")).toBe("sk-real-2");
  });

  it("falls back to a stored key instead of the placeholder", async () => {
    getApiKeys.mockResolvedValue(keys);
    expect(await resolveCliApiKeyForWrite(undefined)).toBe("sk-real-1");
    expect(await resolveCliApiKeyForWrite(CLI_PLACEHOLDER_API_KEY)).toBe("sk-real-1");
  });

  it("keeps the placeholder when the DB has no keys or is unavailable", async () => {
    getApiKeys.mockResolvedValue([]);
    expect(await resolveCliApiKeyForWrite("")).toBe(CLI_PLACEHOLDER_API_KEY);
    dbDown = true;
    expect(await resolveCliApiKeyForWrite("")).toBe(CLI_PLACEHOLDER_API_KEY);
  });
});
