import { describe, expect, it } from "vitest";
import { ANTIGRAVITY_VERSION, INTERNAL_REQUEST_HEADER } from "../../open-sse/config/appConstants.js";
import { getModelsByProviderId } from "../../open-sse/config/providerModels.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import {
  AntigravityExecutor,
  getAntigravityDefaultThinkingLevel,
  readAntigravityResponseBodyForRetry,
  resolveAntigravityWireModel,
  shouldRetryAntigravityEndpointUnavailable,
} from "../../open-sse/executors/antigravity.js";
import { normalizeAntigravityQuotaModel } from "../../open-sse/services/usage.js";

function baseBody(generationConfig = {}) {
  return {
    request: {
      contents: [
        { role: "user", parts: [{ text: "hello" }] },
      ],
      generationConfig,
    },
  };
}

describe("Antigravity Gemini 3.5 Flash variants", () => {
  it("exposes public 3.5 model ids without backend wire ids", () => {
    const ids = getModelsByProviderId("antigravity").map((model) => model.id);

    expect(ids).toContain("gemini-3.5-flash");
    expect(ids).toContain("gemini-3.5-flash-high");
    expect(ids).toContain("gemini-3.5-flash-medium");
    expect(ids).not.toContain("gemini-3-flash-agent");
    expect(ids).not.toContain("gemini-3.5-flash-low");
  });

  it("uses Antigravity 2.x endpoint order and headers", () => {
    const executor = new AntigravityExecutor();
    const headers = executor.buildHeaders({ accessToken: "token" }, true, "session-1");

    expect(PROVIDERS.antigravity.baseUrls).toEqual([
      "https://daily-cloudcode-pa.googleapis.com",
      "https://autopush-cloudcode-pa.sandbox.googleapis.com",
      "https://cloudcode-pa.googleapis.com",
    ]);
    expect(headers["User-Agent"]).toMatch(new RegExp(`^antigravity/${ANTIGRAVITY_VERSION} `));
    expect(headers[INTERNAL_REQUEST_HEADER.name]).toBe(INTERNAL_REQUEST_HEADER.value);
    expect(headers["X-Machine-Session-Id"]).toBe("session-1");
  });

  it("maps public 3.5 ids to the real Antigravity wire model ids", () => {
    expect(resolveAntigravityWireModel("gemini-3.5-flash-high")).toBe("gemini-3-flash-agent");
    expect(resolveAntigravityWireModel("gemini-3.5-flash-medium")).toBe("gemini-3.5-flash-low");
    expect(resolveAntigravityWireModel("gemini-3.5-flash")).toBe("gemini-3.5-flash-low");
    expect(resolveAntigravityWireModel("gemini-3-flash-high")).toBe("gemini-3-flash");
  });

  it("keeps high and medium variant thinking distinct", () => {
    const executor = new AntigravityExecutor();

    const high = executor.transformRequest(
      "gemini-3.5-flash-high",
      baseBody({ maxOutputTokens: 64000 }),
      false,
      { projectId: "project-1", email: "test@example.com" },
    );
    const medium = executor.transformRequest(
      "gemini-3.5-flash-medium",
      baseBody(),
      false,
      { projectId: "project-1", email: "test@example.com" },
    );

    expect(high.model).toBe("gemini-3-flash-agent");
    expect(high.request.generationConfig.maxOutputTokens).toBe(16384);
    expect(high.request.generationConfig.thinkingConfig).toEqual({
      thinkingLevel: "high",
      includeThoughts: true,
    });

    expect(medium.model).toBe("gemini-3.5-flash-low");
    expect(medium.request.generationConfig.thinkingConfig).toEqual({
      thinkingLevel: "medium",
      includeThoughts: true,
    });
    expect(getAntigravityDefaultThinkingLevel("gemini-3.5-flash")).toBe("");
  });

  it("does not overwrite explicit thinking config", () => {
    const executor = new AntigravityExecutor();
    const request = executor.transformRequest(
      "gemini-3.5-flash-medium",
      baseBody({ thinkingConfig: { thinkingBudget: 2048, include_thoughts: true } }),
      false,
      { projectId: "project-1", email: "test@example.com" },
    );

    expect(request.model).toBe("gemini-3.5-flash-low");
    expect(request.request.generationConfig.thinkingConfig).toEqual({
      thinkingBudget: 2048,
      include_thoughts: true,
    });
  });

  it("retries endpoint misses without treating staging 403 as account auth failure", () => {
    const staging403 = JSON.stringify({
      error: {
        code: 403,
        message: "Gemini for Google Cloud API (Staging) has not been used in project p before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/staging-cloudaicompanion.sandbox.googleapis.com/overview?project=p",
      },
    });

    expect(shouldRetryAntigravityEndpointUnavailable(404, "")).toBe(true);
    expect(shouldRetryAntigravityEndpointUnavailable(403, staging403)).toBe(true);
    expect(shouldRetryAntigravityEndpointUnavailable(403, "generic permission denied")).toBe(false);
  });

  it("reads retry response bodies when DNS-bypass responses have no clone method", async () => {
    await expect(readAntigravityResponseBodyForRetry({
      text: async () => "not found",
    })).resolves.toBe("not found");

    await expect(readAntigravityResponseBodyForRetry({
      clone: () => ({ text: async () => "cloned body" }),
      text: async () => "original body",
    })).resolves.toBe("cloned body");
  });

  it("normalizes quota-only backend 3.5 ids for usage display", () => {
    expect(normalizeAntigravityQuotaModel("gemini-3-flash-agent")).toEqual({
      id: "gemini-3.5-flash-high",
      displayName: "Gemini 3.5 Flash (High)",
    });
    expect(normalizeAntigravityQuotaModel("gemini-3.5-flash-low")).toEqual({
      id: "gemini-3.5-flash-medium",
      displayName: "Gemini 3.5 Flash (Medium)",
    });
  });
});
