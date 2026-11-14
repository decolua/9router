import { describe, expect, it, vi } from "vitest";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";

const fsMock = vi.hoisted(() => ({
  store: null,
  readFile: vi.fn(async () => {
    if (fsMock.store === null) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    return fsMock.store;
  }),
  writeFile: vi.fn(async (_p, content) => { fsMock.store = content; }),
  mkdir: vi.fn(async () => {}),
  access: vi.fn(async () => {}),
}));

vi.mock("fs/promises", () => ({ default: fsMock, ...fsMock }));
vi.mock("../../src/app/api/cli-tools/resolveApiKey.js", () => ({
  resolveCliApiKey: vi.fn(async () => "test-key"),
}));

const { POST } = await import("../../src/app/api/cli-tools/opencode-settings/route.js");

const post = (body) => POST({ json: async () => body });
const written = () => JSON.parse(fsMock.store).provider["9router"].models;

describe("opencode-settings POST effort variants", () => {
  it("writes variants from the levels 9Router offers for the model", async () => {
    fsMock.store = null;
    await post({ baseUrl: "http://localhost:20128", models: ["cc/claude-haiku-5-5"] });
    const levels = getThinkingLevels("claude", "claude-haiku-5-5");
    expect(Object.keys(written()["cc/claude-haiku-5-5"].variants)).toEqual(levels);
    expect(written()["cc/claude-haiku-5-5"].variants.high).toEqual({ reasoningEffort: "high" });
  });

  it("keeps variants the user already customized", async () => {
    const custom = { low: { reasoningEffort: "low" } };
    fsMock.store = JSON.stringify({
      provider: { "9router": { npm: "@ai-sdk/openai-compatible", options: {}, models: { "cc/claude-haiku-5-5": { name: "x", variants: custom } } } },
    });
    await post({ baseUrl: "http://localhost:20128", models: ["cc/claude-haiku-5-5"] });
    expect(written()["cc/claude-haiku-5-5"].variants).toEqual(custom);
  });
});
