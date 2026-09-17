import { describe, expect, it } from "vitest";
import opencode from "../../open-sse/providers/registry/opencode.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";
import { getModelTargetFormat } from "../../open-sse/config/providerModels.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const MODEL = "union-alpha";
const PROVIDER = "opencode";

describe("OpenCode Free union-alpha integration", () => {
  it("declares union-alpha in the registry with targetFormat claude", () => {
    const modelEntry = opencode.models.find((m) => m.id === MODEL);
    expect(modelEntry).toBeDefined();
    expect(modelEntry?.name).toBe("Union Alpha Free");
    expect(modelEntry?.targetFormat).toBe(FORMATS.CLAUDE);
    expect(getModelTargetFormat("oc", MODEL)).toBe(FORMATS.CLAUDE);
  });

  it("advertises correct capabilities: vision, 262K contextWindow, 131K maxOutput", () => {
    const caps = getCapabilitiesForModel(PROVIDER, MODEL);
    expect(caps.vision).toBe(true);
    expect(caps.contextWindow).toBe(262144);
    expect(caps.maxOutput).toBe(131072);
  });

  it("routes union-alpha to /zen/v1/messages endpoint", () => {
    const executor = new OpenCodeExecutor();
    expect(executor.buildUrl(MODEL)).toBe("https://opencode.ai/zen/v1/messages");
  });

  it("builds correct headers with OpenCode CLI UA, timestamp-encoded session/request, and anthropic headers", () => {
    const executor = new OpenCodeExecutor();
    const url = executor.buildUrl(MODEL);
    const headers = executor.buildHeaders({}, true, url, MODEL);

    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Authorization"]).toBe("Bearer public");
    expect(headers["x-api-key"]).toBe("public");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["x-opencode-client"]).toBe("cli");
    expect(headers["x-opencode-session"]).toMatch(/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
    expect(headers["x-opencode-request"]).toMatch(/^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
    expect(headers["x-opencode-project"]).toMatch(/^[0-9a-f]{40}$/);
  });
});
