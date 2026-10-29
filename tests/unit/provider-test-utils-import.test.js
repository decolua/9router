import { describe, expect, it } from "vitest";

import { getKimchiUserAgent } from "../../open-sse/utils/kimchiUserAgent.js";

describe("provider test utilities", () => {
  it("returns the deterministic Kimchi user-agent", () => {
    expect(getKimchiUserAgent()).toBe("kimchi/0.1.58");
  });

  it("evaluates the provider test utilities module", async () => {
    const module = await import("../../src/app/api/providers/[id]/test/testUtils.js");

    expect(module.testSingleConnection).toBeTypeOf("function");
  });
});
