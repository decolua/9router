import { describe, it, expect, vi, beforeEach } from "vitest";
import { markAccountUnavailable } from "../../src/sse/services/auth.js";
import * as localDb from "@/lib/localDb";

vi.mock("@/lib/localDb", () => {
  return {
    getProviderConnections: vi.fn(),
    updateProviderConnection: vi.fn(),
    getSettings: vi.fn().mockResolvedValue({}),
  };
});

describe("Kiro Account Deactivation on Suspension", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should deactivate Kiro account permanently if error contains suspension/lock message", async () => {
    const mockConnection = {
      id: "conn-kiro-1",
      name: "clotilde3209",
      provider: "kiro",
      isActive: true,
      backoffLevel: 0,
    };

    localDb.getProviderConnections.mockResolvedValue([mockConnection]);
    localDb.updateProviderConnection.mockResolvedValue({});

    const errorText = `[ERROR] [403]: {"message":"Your User ID (c498b4d8-5031-70fe-104f-b46b056e5029) temporarily is suspended. We've locked your account as a security precaution. To restore access, please contact our support team to verify your identity: https://app.kiro.dev/account/usage?support_form","reason":null}`;

    const result = await markAccountUnavailable(
      "conn-kiro-1",
      403,
      errorText,
      "kiro",
      "claude-sonnet-4.5"
    );

    // Assert deactivation payload
    expect(localDb.updateProviderConnection).toHaveBeenCalledWith("conn-kiro-1", expect.objectContaining({
      isActive: false,
      testStatus: "unavailable",
      lastError: expect.stringContaining("Suspended:"),
      errorCode: 403,
    }));

    // Assert return values
    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBe(5 * 60 * 60 * 1000); // 5 hours fallback cooldown
  });
});
