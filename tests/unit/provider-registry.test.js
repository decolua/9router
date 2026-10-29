import { describe, expect, it } from "vitest";
import registry from "../../open-sse/providers/registry/index.js";

describe("provider registry imports", () => {
  it("has one entry per provider id and retains fork providers", () => {
    const ids = registry.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(["freebuff", "kenari", "qoder-cn", "xquik"]));
  });
});
