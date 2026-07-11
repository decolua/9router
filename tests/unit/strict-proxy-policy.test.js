import { describe, expect, it } from "vitest";
import {
  resolveStrictProxyFlag,
  shouldForceStrictProxy,
  withStrictProxyEnforced,
} from "../../src/lib/network/strictProxyPolicy.js";

describe("strictProxy policy", () => {
  it.each(["antigravity", "xai", "github"])(
    "forces strictProxy for sensitive provider %s",
    (providerId) => {
      expect(shouldForceStrictProxy(providerId)).toBe(true);
      expect(resolveStrictProxyFlag({
        providerId,
        connectionStrictProxy: false,
        nestedStrictProxy: false,
        resolvedStrictProxy: false,
      })).toBe(true);
    }
  );

  it("preserves explicit true for non-sensitive providers", () => {
    expect(resolveStrictProxyFlag({
      providerId: "codex",
      connectionStrictProxy: true,
      nestedStrictProxy: false,
      resolvedStrictProxy: false,
    })).toBe(true);
    expect(resolveStrictProxyFlag({
      providerId: "codex",
      connectionStrictProxy: false,
      nestedStrictProxy: true,
      resolvedStrictProxy: false,
    })).toBe(true);
    expect(resolveStrictProxyFlag({
      providerId: "codex",
      connectionStrictProxy: false,
      nestedStrictProxy: false,
      resolvedStrictProxy: true,
    })).toBe(true);
  });

  it("defaults to false for non-sensitive providers without flags", () => {
    expect(shouldForceStrictProxy("codex")).toBe(false);
    expect(resolveStrictProxyFlag({
      providerId: "codex",
      connectionStrictProxy: false,
      nestedStrictProxy: false,
      resolvedStrictProxy: false,
    })).toBe(false);
  });

  it("enforces top-level and nested strictProxy on sensitive connection writes", () => {
    const enforced = withStrictProxyEnforced({
      provider: "xai",
      name: "acct",
      providerSpecificData: { region: "us" },
    });

    expect(enforced).toEqual({
      provider: "xai",
      name: "acct",
      strictProxy: true,
      providerSpecificData: {
        region: "us",
        strictProxy: true,
      },
    });
  });

  it("does not mutate non-sensitive connection writes", () => {
    const input = {
      provider: "codex",
      name: "acct",
      providerSpecificData: { chatgptAccountId: "ws_1" },
    };
    expect(withStrictProxyEnforced(input)).toEqual(input);
  });
});
