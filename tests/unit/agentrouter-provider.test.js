import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { resolveProviderAlias } from "../../open-sse/services/model.js";
import { CLAUDE_CLI_SPOOF_HEADERS } from "../../open-sse/providers/shared.js";

describe("AgentRouter provider", () => {
  const ar = REGISTRY.find((e) => e.id === "agentrouter");

  it("is registered as an OpenAI-compatible apikey provider", () => {
    expect(ar).toBeDefined();
    expect(ar.category).toBe("apikey");
    expect(ar.transport.baseUrl).toBe("https://agentrouter.org/v1/chat/completions");
    expect(ar.transport.format ?? "openai").toBe("openai");
  });

  it("spoofs the claude-cli User-Agent the gateway gates on", () => {
    expect(PROVIDERS.agentrouter.headers["User-Agent"]).toBe(CLAUDE_CLI_SPOOF_HEADERS["User-Agent"]);
  });

  it("accepts any model via passthrough + resolves the ar alias", () => {
    expect(ar.passthroughModels).toBe(true);
    expect(resolveProviderAlias("ar")).toBe("agentrouter");
    expect((PROVIDER_MODELS.ar || []).map((m) => m.id)).toContain("deepseek-v4-flash");
  });

  it("builds the request url + bearer auth + spoofed UA", () => {
    const ex = new DefaultExecutor("agentrouter");
    const url = ex.buildUrl("deepseek-v4-flash", true, 0, { apiKey: "sk-TEST" });
    const headers = ex.buildHeaders({ apiKey: "sk-TEST" }, true, url, "deepseek-v4-flash");
    expect(url).toBe("https://agentrouter.org/v1/chat/completions");
    expect(headers["Authorization"]).toBe("Bearer sk-TEST");
    expect(headers["User-Agent"]).toBe("claude-cli/2.1.251 (external, sdk-cli)");
  });

  it("keeps every registry id unique", () => {
    const ids = REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
