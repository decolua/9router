import { describe, it, expect, beforeEach } from "vitest";

import {
  deriveStickyAccountKey,
  getStickyAccount,
  setStickyAccount,
  clearStickyAccount,
  resetStickyAccountStore,
} from "../../open-sse/services/stickyAccount.js";

describe("sticky-account routing", () => {
  beforeEach(() => {
    resetStickyAccountStore();
  });

  const sessionBody = (overrides = {}) => ({
    tools: [{ type: "function", function: { name: "read" } }],
    messages: [
      { role: "system", content: "You are a coding agent" },
      { role: "user", content: "fix foo.js" },
    ],
    ...overrides,
  });

  it("returns the same key across turns of the same session", () => {
    const a = deriveStickyAccountKey(sessionBody(), "claude", "sonnet-4.5");
    const b = deriveStickyAccountKey(
      sessionBody({ messages: [
        { role: "system", content: "You are a coding agent" },
        { role: "user", content: "fix foo.js" },
        { role: "assistant", content: "done" },
        { role: "user", content: "now write a test" },
      ] }),
      "claude",
      "sonnet-4.5",
    );
    expect(a).toBe(b);
  });

  it("scopes by provider/model", () => {
    const a = deriveStickyAccountKey(sessionBody(), "claude", "sonnet-4.5");
    const b = deriveStickyAccountKey(sessionBody(), "claude", "haiku");
    const c = deriveStickyAccountKey(sessionBody(), "kr", "sonnet-4.5");
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
  });

  it("returns null when the body has no anchor text", () => {
    expect(deriveStickyAccountKey({ tools: [] }, "claude", "sonnet-4.5")).toBeNull();
    expect(deriveStickyAccountKey({ messages: [] }, "claude", "sonnet-4.5")).toBeNull();
  });

  it("stores and retrieves the pinned connection", () => {
    const key = deriveStickyAccountKey(sessionBody(), "claude", "sonnet-4.5");
    expect(getStickyAccount(key)).toBeNull();

    setStickyAccount(key, "conn-1");
    expect(getStickyAccount(key)).toBe("conn-1");

    setStickyAccount(key, "conn-2");
    expect(getStickyAccount(key)).toBe("conn-2");
  });

  it("clears the pin", () => {
    const key = deriveStickyAccountKey(sessionBody(), "claude", "sonnet-4.5");
    setStickyAccount(key, "conn-1");
    clearStickyAccount(key);
    expect(getStickyAccount(key)).toBeNull();
  });

  it("ignores set on null key or null connectionId", () => {
    setStickyAccount(null, "conn-1");
    setStickyAccount("k", null);
    expect(getStickyAccount(null)).toBeNull();
    expect(getStickyAccount("k")).toBeNull();
  });
});
