import { describe, expect, it } from "vitest";

import {
  DEFAULT_PROXY_CLIENT_MAX_BODY_SIZE,
  resolveProxyClientMaxBodySize,
} from "../../next.config.mjs";

describe("Next proxy client body size", () => {
  it("defaults to 256 MB so Codex screenshot-heavy requests do not fail at 10 MB", () => {
    expect(DEFAULT_PROXY_CLIENT_MAX_BODY_SIZE).toBe(256 * 1024 * 1024);
    expect(resolveProxyClientMaxBodySize()).toBe(256 * 1024 * 1024);
  });

  it("accepts numeric byte overrides from NEXT_PROXY_CLIENT_MAX_BODY_SIZE", () => {
    expect(resolveProxyClientMaxBodySize("52428800")).toBe(52428800);
  });

  it("passes Next.js size strings through for built-in validation", () => {
    expect(resolveProxyClientMaxBodySize("50mb")).toBe("50mb");
  });
});
