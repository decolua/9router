import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getKiroUsage: vi.fn(),
}));

vi.mock("../../open-sse/services/usage/kiro.js", () => ({
  getKiroUsage: mocks.getKiroUsage,
}));

// Verified shape of a real CodeWhisperer GenerateAssistantResponse 402 body
// (AWS ServiceQuotaExceededException, reason MONTHLY_REQUEST_COUNT).
const CONFIRMED_BODY = JSON.stringify({
  code: "QModelResponse",
  requestId: "d8a9e87f-2cbb-4cc5-8085-c3336cd8bf98",
  name: "Error",
  message: "You have reached the limit.",
  cause: {
    $fault: "client",
    $metadata: { httpStatusCode: 402, requestId: "d8a9e87f-2cbb-4cc5-8085-c3336cd8bf98", attempts: 1, totalRetryDelay: 0 },
    name: "ServiceQuotaExceededException",
    reason: "MONTHLY_REQUEST_COUNT",
  },
});

describe("Kiro executor — 402 credit-exhaustion classification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("derives resetsAtMs from Kiro's own quota API on confirmed exhaustion", async () => {
    const { KiroExecutor } = await import("../../open-sse/executors/kiro.js");
    const resetAtIso = new Date(Date.now() + 9 * 24 * 60 * 60 * 1000).toISOString();
    mocks.getKiroUsage.mockResolvedValue({
      plan: "Kiro Free",
      quotas: {
        agentic_request: { used: 50, total: 50, remaining: 0, resetAt: resetAtIso, unlimited: false },
      },
    });

    const executor = new KiroExecutor();
    const credentials = { accessToken: "token-1", providerSpecificData: { authMethod: "builder-id" } };
    const result = await executor.parseError({ status: 402 }, CONFIRMED_BODY, credentials, {});

    expect(mocks.getKiroUsage).toHaveBeenCalledWith("token-1", credentials.providerSpecificData, {});
    expect(result.status).toBe(402);
    expect(result.resetsAtMs).toBe(new Date(resetAtIso).getTime());
  });

  it("prefers the api-key credential over accessToken when both are present", async () => {
    const { KiroExecutor } = await import("../../open-sse/executors/kiro.js");
    mocks.getKiroUsage.mockResolvedValue({ quotas: {} });
    const executor = new KiroExecutor();
    const credentials = { accessToken: "oidc-token", apiKey: "raw-api-key", providerSpecificData: { authMethod: "api_key" } };
    await executor.parseError({ status: 402 }, CONFIRMED_BODY, credentials, {});
    expect(mocks.getKiroUsage).toHaveBeenCalledWith("raw-api-key", credentials.providerSpecificData, {});
  });

  it("falls back to the daily-probe window when the quota lookup has nothing depleted", async () => {
    const { KiroExecutor } = await import("../../open-sse/executors/kiro.js");
    const { KIRO_CREDIT_EXHAUSTION_PROBE_MS } = await import("../../open-sse/config/errorConfig.js");
    mocks.getKiroUsage.mockResolvedValue({ plan: "Kiro Free", quotas: {} });

    const executor = new KiroExecutor();
    const before = Date.now();
    const result = await executor.parseError({ status: 402 }, CONFIRMED_BODY, { accessToken: "t" }, {});
    const after = Date.now();

    expect(result.resetsAtMs).toBeGreaterThanOrEqual(before + KIRO_CREDIT_EXHAUSTION_PROBE_MS);
    expect(result.resetsAtMs).toBeLessThanOrEqual(after + KIRO_CREDIT_EXHAUSTION_PROBE_MS);
  });

  it("falls back to the daily-probe window when the quota lookup fails", async () => {
    const { KiroExecutor } = await import("../../open-sse/executors/kiro.js");
    const { KIRO_CREDIT_EXHAUSTION_PROBE_MS } = await import("../../open-sse/config/errorConfig.js");
    mocks.getKiroUsage.mockRejectedValue(new Error("network down"));

    const executor = new KiroExecutor();
    const result = await executor.parseError({ status: 402 }, CONFIRMED_BODY, { accessToken: "t" }, {});
    expect(result.resetsAtMs).toBeGreaterThan(Date.now());
    expect(result.resetsAtMs).toBeLessThanOrEqual(Date.now() + KIRO_CREDIT_EXHAUSTION_PROBE_MS + 1000);
  });

  it("leaves an ambiguous 402 unclassified, preserving the existing generic cooldown", async () => {
    const { KiroExecutor } = await import("../../open-sse/executors/kiro.js");
    const executor = new KiroExecutor();
    const result = await executor.parseError(
      { status: 402 },
      JSON.stringify({ message: "Payment method declined" }),
      { accessToken: "t" },
      {}
    );
    expect(result.resetsAtMs).toBeUndefined();
    expect(mocks.getKiroUsage).not.toHaveBeenCalled();
  });

  it("does not classify non-402 statuses", async () => {
    const { KiroExecutor } = await import("../../open-sse/executors/kiro.js");
    const executor = new KiroExecutor();
    const result = await executor.parseError({ status: 429 }, "Too many requests", { accessToken: "t" }, {});
    expect(result.resetsAtMs).toBeUndefined();
    expect(mocks.getKiroUsage).not.toHaveBeenCalled();
  });

  it("also recognizes the confirmed signal when cause fields are flattened to the top level", async () => {
    const { KiroExecutor } = await import("../../open-sse/executors/kiro.js");
    mocks.getKiroUsage.mockResolvedValue({ quotas: {} });
    const flatBody = JSON.stringify({
      name: "ServiceQuotaExceededException",
      reason: "MONTHLY_REQUEST_COUNT",
      message: "You have reached the limit.",
    });
    const executor = new KiroExecutor();
    const result = await executor.parseError({ status: 402 }, flatBody, { accessToken: "t" }, {});
    expect(mocks.getKiroUsage).toHaveBeenCalled();
    expect(result.resetsAtMs).toBeGreaterThan(Date.now());
  });
});
