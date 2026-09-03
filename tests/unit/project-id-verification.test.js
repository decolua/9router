import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getProjectIdForConnection,
  invalidateProjectId,
  extractVerificationUrl,
} from "../../open-sse/services/projectId.js";
import {
  getAntigravityVerification,
  clearAntigravityVerification,
} from "../../src/lib/db/repos/usageRepo.js";

describe("ProjectId Antigravity Verification Extraction", () => {
  beforeEach(() => {
    clearAntigravityVerification("conn_ag_1");
    clearAntigravityVerification("conn_ag_2");
    clearAntigravityVerification("conn_cli_1");
    clearAntigravityVerification("default");
    invalidateProjectId("conn_ag_1");
    invalidateProjectId("conn_ag_2");
    invalidateProjectId("conn_cli_1");
    vi.restoreAllMocks();
  });

  it("extracts validationUrl from successful loadCodeAssist ineligibleTiers", () => {
    const data = {
      ineligibleTiers: [
        {
          id: "standard-tier",
          validationErrorMessage: "Validation required to use standard tier",
          validationUrl: "https://accounts.google.com/signin/continue?sarp=1&continue=https://console.cloud.google.com"
        }
      ]
    };

    const url = extractVerificationUrl(data);
    expect(url).toBe("https://accounts.google.com/signin/continue?sarp=1&continue=https://console.cloud.google.com");
  });

  it("extracts appeal_url from non-OK error response details", () => {
    const errorBody = {
      error: {
        code: 403,
        message: "PERMISSION_DENIED: User validation required",
        status: "PERMISSION_DENIED",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason: "VALIDATION_REQUIRED",
            metadata: {
              appeal_url: "https://accounts.google.com/signin/continue?flowName=GlifWebSignIn"
            }
          }
        ]
      }
    };

    const url = extractVerificationUrl(errorBody);
    expect(url).toBe("https://accounts.google.com/signin/continue?flowName=GlifWebSignIn");
  });

  it("ignores non-HTTPS or non-accounts.google.com support URLs", () => {
    const supportPayload = {
      ineligibleTiers: [
        {
          id: "standard-tier",
          validationErrorMessage: "Need help",
          validationUrl: "https://support.google.com/a/answer/123456"
        }
      ],
      error: {
        message: "validation required",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason: "VALIDATION_REQUIRED",
            metadata: {
              validation_url: "http://accounts.google.com/signin/continue?sarp=1"
            }
          }
        ]
      }
    };

    const url = extractVerificationUrl(supportPayload);
    expect(url).toBeNull();
  });

  it("publishes verification to usageDb when getProjectIdForConnection hits ineligible tier", async () => {
    const mockPayload = {
      ineligibleTiers: [
        {
          validationErrorMessage: "Validation required",
          validationUrl: "https://accounts.google.com/signin/continue?id=ag123"
        }
      ]
    };

    globalThis.fetch = vi.fn().mockImplementation(async (url) => {
      if (typeof url === "string" && url.includes("loadCodeAssist")) {
        return new Response(JSON.stringify(mockPayload), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (typeof url === "string" && url.includes("onboardUser")) {
        return new Response(JSON.stringify({ done: true, response: { cloudaicompanionProject: { id: "test-proj" } } }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response("{}", { status: 200 });
    });

    const pid = await getProjectIdForConnection("conn_ag_1", "fake-token", "antigravity");
    expect(pid).toBe("test-proj");

    const verification = getAntigravityVerification("conn_ag_1");
    expect(verification).not.toBeNull();
    expect(verification.url).toBe("https://accounts.google.com/signin/continue?id=ag123");
    expect(verification.connectionId).toBe("conn_ag_1");
  });

  it("publishes verification to usageDb when loadCodeAssist returns 403 with error validation URL without leaking body/url in logs", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mockError = {
      error: {
        code: 403,
        message: "Validation required",
        details: [
          {
            reason: "VALIDATION_REQUIRED",
            metadata: {
              validation_url: "https://accounts.google.com/signin/continue?sarp=403"
            }
          }
        ]
      }
    };

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockError), {
        status: 403,
        headers: { "Content-Type": "application/json" }
      })
    );

    const pid = await getProjectIdForConnection("conn_ag_2", "fake-token", "antigravity");
    expect(pid).toBeNull();

    const verification = getAntigravityVerification("conn_ag_2");
    expect(verification).not.toBeNull();
    expect(verification.url).toBe("https://accounts.google.com/signin/continue?sarp=403");
    expect(verification.connectionId).toBe("conn_ag_2");

    const loggedWarnings = warnSpy.mock.calls.map(call => call.join(" ")).join("\n");
    expect(loggedWarnings).not.toContain("accounts.google.com/signin/continue");
    expect(loggedWarnings).not.toContain("VALIDATION_REQUIRED");
    expect(loggedWarnings).toContain("loadCodeAssist failed: HTTP 403");
  });

  it("does not publish verification for non-antigravity providers", async () => {
    const mockPayload = {
      ineligibleTiers: [
        {
          validationErrorMessage: "Validation required",
          validationUrl: "https://accounts.google.com/signin/continue?id=gemini123"
        }
      ]
    };

    globalThis.fetch = vi.fn().mockImplementation(async (url) => {
      if (typeof url === "string" && url.includes("loadCodeAssist")) {
        return new Response(JSON.stringify(mockPayload), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (typeof url === "string" && url.includes("onboardUser")) {
        return new Response(JSON.stringify({ done: true, response: { cloudaicompanionProject: { id: "test-proj" } } }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response("{}", { status: 200 });
    });

    await getProjectIdForConnection("conn_cli_1", "fake-token", "gemini-cli");
    const verification = getAntigravityVerification("conn_cli_1");
    expect(verification).toBeNull();
  });
});
