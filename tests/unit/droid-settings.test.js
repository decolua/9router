import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init) => ({ body, init }),
  },
}));

const { is9RouterConfig } = await import("../../src/app/api/cli-tools/droid-settings/utils.js");

describe("Droid settings ownership", () => {
  it("does not treat base URL equality alone as 9Router ownership", () => {
    const userModel = {
      model: "user/custom-model",
      baseUrl: "http://127.0.0.1:20128/v1",
      apiKey: "user-owned-key",
      provider: "generic-chat-completion-api",
    };

    expect(is9RouterConfig(userModel, "http://127.0.0.1:20128/v1")).toBe(false);
  });

  it("recognizes explicit 9Router Droid entries", () => {
    expect(is9RouterConfig({ id: "custom:9Router-0" })).toBe(true);
    expect(is9RouterConfig({ apiKey: "sk_9router", baseUrl: "http://127.0.0.1:20128/v1" })).toBe(true);
  });
});
