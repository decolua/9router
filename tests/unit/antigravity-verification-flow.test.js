import { describe, it, expect, beforeEach } from "vitest";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { parseUpstreamError, createErrorResult } from "../../open-sse/utils/error.js";
import {
  setAntigravityVerification,
  clearAntigravityVerification,
  getAntigravityVerification,
  getAllAntigravityVerifications,
  getActiveRequests,
} from "../../src/lib/db/repos/usageRepo.js";

describe("Antigravity Verification Parser and Flow", () => {
  const executor = new AntigravityExecutor();

  beforeEach(() => {
    clearAntigravityVerification("conn_1");
    clearAntigravityVerification("conn_2");
    clearAntigravityVerification("default");
  });

  it("extracts verification_url from ErrorInfo metadata", async () => {
    const rawBody = JSON.stringify({
      error: {
        code: 403,
        message: "PERMISSION_DENIED: Validation required to continue using the service",
        status: "PERMISSION_DENIED",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason: "VALIDATION_REQUIRED",
            domain: "googleapis.com",
            metadata: {
              validation_url: "https://accounts.google.com/signin/continue?sarp=1&continue=https://console.cloud.google.com"
            }
          },
          {
            "@type": "type.googleapis.com/google.rpc.Help",
            links: [
              {
                description: "Google support",
                url: "https://support.google.com/a/answer/123456"
              }
            ]
          }
        ]
      }
    });

    const mockResponse = {
      status: 403,
      text: async () => rawBody
    };

    const parsed = await parseUpstreamError(mockResponse, executor);
    expect(parsed.statusCode).toBe(403);
    expect(parsed.verificationUrl).toBe("https://accounts.google.com/signin/continue?sarp=1&continue=https://console.cloud.google.com");

    const errorResult = createErrorResult(parsed.statusCode, parsed.message, parsed.resetsAtMs, parsed.verificationUrl);
    expect(errorResult.verificationUrl).toBe("https://accounts.google.com/signin/continue?sarp=1&continue=https://console.cloud.google.com");
  });

  it("extracts Help link if ErrorInfo metadata is absent but validation reason present", async () => {
    const rawBody = JSON.stringify({
      error: {
        code: 403,
        message: "Validation required for account",
        status: "PERMISSION_DENIED",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason: "VALIDATION_REQUIRED",
            domain: "googleapis.com"
          },
          {
            "@type": "type.googleapis.com/google.rpc.Help",
            links: [
              {
                description: "Continue sign in",
                url: "https://accounts.google.com/signin/continue?flowName=GlifWebSignIn"
              }
            ]
          }
        ]
      }
    });

    const mockResponse = {
      status: 403,
      text: async () => rawBody
    };

    const parsed = await parseUpstreamError(mockResponse, executor);
    expect(parsed.verificationUrl).toBe("https://accounts.google.com/signin/continue?flowName=GlifWebSignIn");
  });

  it("falls back to bounded regex only when validation wording is present", async () => {
    const rawBody = JSON.stringify({
      error: {
        code: 403,
        message: "Validation required: visit https://accounts.google.com/signin/continue?flowEntry=ServiceLogin to unlock",
        status: "PERMISSION_DENIED"
      }
    });

    const mockResponse = {
      status: 403,
      text: async () => rawBody
    };

    const parsed = await parseUpstreamError(mockResponse, executor);
    expect(parsed.verificationUrl).toBe("https://accounts.google.com/signin/continue?flowEntry=ServiceLogin");
  });

  it("rejects non-Google or malformed URLs and does not extract support links as verification", async () => {
    const rawBody = JSON.stringify({
      error: {
        code: 403,
        message: "Validation required",
        status: "PERMISSION_DENIED",
        details: [
          {
            reason: "VALIDATION_REQUIRED",
            metadata: {
              validation_url: "http://malicious.com/signin/continue"
            }
          },
          {
            "@type": "type.googleapis.com/google.rpc.Help",
            links: [
              {
                description: "Support URL",
                url: "https://support.google.com/cloud/answer/123"
              }
            ]
          }
        ]
      }
    });

    const mockResponse = {
      status: 403,
      text: async () => rawBody
    };

    const parsed = await parseUpstreamError(mockResponse, executor);
    expect(parsed.verificationUrl).toBeUndefined();
  });

  it("returns null/undefined verification for ordinary 403/429 quota errors", async () => {
    const rawBody = JSON.stringify({
      error: {
        code: 429,
        message: "Resource has been exhausted (e.g. check quota)",
        status: "RESOURCE_EXHAUSTED"
      }
    });

    const mockResponse = {
      status: 429,
      text: async () => rawBody
    };

    const parsed = await parseUpstreamError(mockResponse, executor);
    expect(parsed.verificationUrl).toBeUndefined();
  });

  it("tracks in-memory verification state per connectionId and clears on matching connection", async () => {
    setAntigravityVerification({
      url: "https://accounts.google.com/signin/continue?id=1",
      connectionId: "conn_1",
      account: "user1@example.com"
    });

    setAntigravityVerification({
      url: "https://accounts.google.com/signin/continue?id=2",
      connectionId: "conn_2",
      account: "user2@example.com"
    });

    expect(getAntigravityVerification("conn_1")?.url).toBe("https://accounts.google.com/signin/continue?id=1");
    expect(getAntigravityVerification("conn_2")?.url).toBe("https://accounts.google.com/signin/continue?id=2");

    const all = getAllAntigravityVerifications();
    expect(all["conn_1"]?.url).toBe("https://accounts.google.com/signin/continue?id=1");
    expect(all["conn_2"]?.url).toBe("https://accounts.google.com/signin/continue?id=2");

    const active = await getActiveRequests();
    expect(active.antigravityVerifications["conn_1"]?.url).toBe("https://accounts.google.com/signin/continue?id=1");
    expect(active.antigravityVerifications["conn_2"]?.url).toBe("https://accounts.google.com/signin/continue?id=2");

    clearAntigravityVerification("conn_1");
    expect(getAntigravityVerification("conn_1")).toBeNull();
    expect(getAntigravityVerification("conn_2")?.url).toBe("https://accounts.google.com/signin/continue?id=2");
    expect(getAllAntigravityVerifications()["conn_1"]).toBeUndefined();
    expect(getAllAntigravityVerifications()["conn_2"]?.url).toBe("https://accounts.google.com/signin/continue?id=2");

    clearAntigravityVerification("conn_2");
    expect(getAntigravityVerification()).toBeNull();
    expect(Object.keys(getAllAntigravityVerifications()).length).toBe(0);
  });

  it("ignores setAntigravityVerification with non-https or non-accounts.google.com URLs", () => {
    setAntigravityVerification({
      url: "https://evil.com/signin/continue",
      connectionId: "conn_evil"
    });
    expect(getAntigravityVerification("conn_evil")).toBeNull();

    setAntigravityVerification({
      url: "http://accounts.google.com/signin/continue",
      connectionId: "conn_http"
    });
    expect(getAntigravityVerification("conn_http")).toBeNull();
  });

  it("does not let invalid first candidate suppress subsequent valid Google verification URL", async () => {
    const rawBody = JSON.stringify({
      error: {
        code: 403,
        message: "Validation required for account",
        status: "PERMISSION_DENIED",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason: "VALIDATION_REQUIRED",
            metadata: {
              validation_url: "https://support.google.com/cloud/answer/123"
            }
          },
          {
            "@type": "type.googleapis.com/google.rpc.Help",
            links: [
              {
                description: "Help invalid",
                url: "http://accounts.google.com/signin/continue?id=insecure"
              },
              {
                description: "Continue sign in",
                url: "https://accounts.google.com/signin/continue?flowName=GlifWebSignIn"
              }
            ]
          }
        ]
      }
    });

    const mockResponse = {
      status: 403,
      text: async () => rawBody
    };

    const parsed = await parseUpstreamError(mockResponse, executor);
    expect(parsed.verificationUrl).toBe("https://accounts.google.com/signin/continue?flowName=GlifWebSignIn");
  });
});
