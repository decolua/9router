import { describe, expect, it } from "vitest";
import { resolveUpstreamRoute } from "../../open-sse/handlers/chatCore/upstreamRoute.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";

// Every model that pins a wire format at the model level, on a provider that has
// more than one endpoint to choose from. These are the pairs where the body format
// and the endpoint can disagree.
const PINNED = [];
for (const [alias, models] of Object.entries(PROVIDER_MODELS)) {
  if (!Array.isArray(PROVIDERS[alias]?.transports)) continue;
  for (const m of models || []) {
    if (m.targetFormat) PINNED.push({ alias, model: m.id, targetFormat: m.targetFormat });
  }
}

describe("upstream route: body format and transport agree", () => {
  it("finds the model-pinned formats it is meant to guard", () => {
    // Guards the loop above: if the registry ever drops these the table below
    // would pass vacuously.
    expect(PINNED.length).toBeGreaterThan(0);
    expect(PINNED.map((p) => `${p.alias}/${p.model}`)).toEqual(
      expect.arrayContaining(["minimax/MiniMax-M3", "minimax-cn/MiniMax-M3"]),
    );
  });

  for (const { alias, model, targetFormat } of PINNED) {
    for (const sourceFormat of ["openai", "claude"]) {
      it(`${alias}/${model}: ${sourceFormat} client → ${targetFormat} body on the ${targetFormat} transport`, () => {
        const route = resolveUpstreamRoute({ provider: alias, alias, model, sourceFormat, credentials: {} });
        expect(route.targetFormat).toBe(targetFormat);
        // Without this, an openai client got the openai transport
        // (/v1/chat/completions, bearer auth) carrying a Claude body.
        expect(route.transport?.format).toBe(targetFormat);
      });
    }
  }
});

describe("upstream route: unpinned models keep the sourceFormat-matched transport", () => {
  const cases = [
    { alias: "minimax", model: "MiniMax-M2.7", sourceFormat: "openai", expected: "openai" },
    { alias: "minimax", model: "MiniMax-M2.7", sourceFormat: "claude", expected: "claude" },
    { alias: "deepseek", model: "deepseek-chat", sourceFormat: "claude", expected: "claude" },
  ];
  for (const { alias, model, sourceFormat, expected } of cases) {
    it(`${alias}/${model} on a ${sourceFormat} client stays ${expected}`, () => {
      const route = resolveUpstreamRoute({ provider: alias, alias, model, sourceFormat, credentials: {} });
      expect(route.targetFormat).toBe(expected);
      expect(route.transport?.format).toBe(expected);
    });
  }
});

describe("upstream route: the per-model transport guard still applies", () => {
  // opencode-go glm-5.2 declares supportedFormats ["openai"] only, so a claude
  // client must not be routed to /v1/messages.
  it("does not hand a claude client the claude transport for a chat-only model", () => {
    const route = resolveUpstreamRoute({
      provider: "opencode-go", alias: "opencode-go", model: "glm-5.2", sourceFormat: "claude", credentials: {},
    });
    expect(route.transport?.format).not.toBe("claude");
  });

  it("keeps the claude transport for a model that declares it", () => {
    const route = resolveUpstreamRoute({
      provider: "opencode-go", alias: "opencode-go", model: "minimax-m3", sourceFormat: "claude", credentials: {},
    });
    expect(route.targetFormat).toBe("claude");
    expect(route.transport?.format).toBe("claude");
  });
});
