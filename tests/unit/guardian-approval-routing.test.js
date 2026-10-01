import { describe, expect, it } from "vitest";

import { getProviderModels } from "../../open-sse/config/providerModels.js";
import { getModelInfoCore } from "../../open-sse/services/model.js";

// Codex CLI's automatic approval (Guardian) review runs in its own child thread and sends the
// bare model id "gpt-5.6-luna" to /v1/responses. Prefix inference matched /^gpt-/ → "openai",
// and a setup with no openai connection answered "No active credentials for provider: openai".
// Only the observed bare Guardian id has evidence for a Copilot exception. The OpenAI registry
// is incomplete, so absence from it does not establish that another GPT id belongs to Copilot.
describe("Codex Guardian approval model routing", () => {
  const infer = async (model) => (await getModelInfoCore(model, {})).provider;

  it("routes the observed bare Guardian id to github", async () => {
    expect(await infer("gpt-5.6-luna")).toBe("github");
    expect(await infer("gpt-5.6-luna(high)")).toBe("github");
  });

  it.each([
    "gpt-5.5-pro",
    "gpt-5.5-pro(high)",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna-preview",
    "gpt-6-astra",
    "gpt-6-sol",
    "gpt-6.1-preview",
  ])("keeps the uncataloged or ambiguous GPT id %s on openai", async (model) => {
    expect(await infer(model)).toBe("openai");
  });

  it.each([
    "gpt-5.5",
    "gpt-5.5(high)",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
    "gpt-5.2",
    "gpt-5.1",
    "gpt-5",
    "gpt-5-mini",
    "gpt-4o",
    "gpt-4-turbo",
  ])("leaves the real openai id %s on openai", async (model) => {
    expect(await infer(model)).toBe("openai");
  });

  // Guards the boundary above: every id the openai catalog claims must still infer as openai,
  // so widening the Copilot pattern can never silently steal a real openai model.
  it("never steals a model the openai catalog actually serves", async () => {
    const stolen = [];
    for (const { id } of getProviderModels("openai")) {
      if ((await infer(id)) !== "openai") stolen.push(id);
    }
    expect(stolen).toEqual([]);
  });

  it.each([
    ["gh/gpt-5.5-pro", "github", "gpt-5.5-pro"],
    ["github/gpt-5.5-pro", "github", "gpt-5.5-pro"],
    ["openai/gpt-5.6-luna", "openai", "gpt-5.6-luna"],
    ["cx/gpt-5.6-luna", "codex", "gpt-5.6-luna"],
  ])("honors the explicit provider in %s", async (input, provider, model) => {
    await expect(getModelInfoCore(input, {})).resolves.toEqual({ provider, model });
  });

  it("resolves a user alias before inferring the bare model provider", async () => {
    await expect(getModelInfoCore("gpt-5.5-pro", {
      "gpt-5.5-pro": "gh/gpt-5.5-pro",
    })).resolves.toEqual({ provider: "github", model: "gpt-5.5-pro" });
  });
});
