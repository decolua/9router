import { describe, it, expect, beforeEach } from "vitest";
import { GlmExecutor, glmRequestContext } from "../../open-sse/executors/glm.js";

function withGlmRequest(credentials, fn, urlIndex = 0) {
  return glmRequestContext.run({ credentials, urlIndex }, fn);
}

/** buildUrl sets urlIndex on the active ALS store (same as production execute loop). */
function atUrlIndex(executor, urlIndex, credentials, fn) {
  return withGlmRequest(credentials, () => {
    executor.buildUrl("glm-5.2", true, urlIndex, credentials);
    return fn();
  });
}

describe("GlmExecutor", () => {
  let executor;

  beforeEach(() => {
    executor = new GlmExecutor();
  });

  const codingPlanCreds = {
    apiKey: "org.key.secret",
    accessToken: "jwt-token",
    providerSpecificData: {
      useCodingPlan: true,
      zcodeJwtToken: "jwt-token",
    },
  };

  it("maps glm-5.2 model in transformRequest", () => {
    const body = executor.transformRequest("glm-5.2", { model: "glm-5.2", messages: [] });
    expect(body.model).toBe("GLM-5.2");
  });

  it("uses full ZCode fingerprint on coding plan primary URL", () => {
    const headers = atUrlIndex(executor, 0, codingPlanCreds, () =>
      executor.buildHeaders({
        ...codingPlanCreds,
        connectionId: "conn-1",
        providerSpecificData: {
          ...codingPlanCreds.providerSpecificData,
          _captchaVerifyParam: "captcha-token",
        },
      })
    );
    expect(headers.Authorization).toBe("Bearer jwt-token");
    expect(headers["x-api-key"]).toBeUndefined();
    expect(headers["User-Agent"]).toBe("ZCode/3.1.0");
    expect(headers["X-ZCode-App-Version"]).toBe("3.1.0");
    expect(headers["X-ZCode-Agent"]).toBe("glm");
    expect(headers["X-Title"]).toBe("Z Code@electron");
    expect(headers["HTTP-Referer"]).toBe("https://zcode.z.ai/");
    expect(headers["X-Aliyun-Captcha-Verify-Param"]).toBe("captcha-token");
    expect(headers["X-Aliyun-Captcha-Verify-Region"]).toBe("sgp");
    expect(headers["x-request-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(headers["x-zcode-trace-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(headers["x-query-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(headers["x-session-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(headers["Anthropic-Version"]).toBeUndefined();
    expect(headers["Anthropic-Beta"]).toBeUndefined();
  });

  it("reuses x-session-id for the same connection", () => {
    const creds = { ...codingPlanCreds, connectionId: "conn-stable" };
    const first = atUrlIndex(executor, 0, creds, () => executor.buildHeaders(creds));
    const second = atUrlIndex(executor, 0, creds, () => executor.buildHeaders(creds));
    expect(second["x-session-id"]).toBe(first["x-session-id"]);
    expect(second["x-request-id"]).not.toBe(first["x-request-id"]);
  });

  it("uses ZCode API key fingerprint on fallback URL after JWT expiry", () => {
    const headers = atUrlIndex(executor, 1, codingPlanCreds, () =>
      executor.buildHeaders({
        ...codingPlanCreds,
        providerSpecificData: {
          ...codingPlanCreds.providerSpecificData,
          _captchaVerifyParam: "captcha-token",
        },
      })
    );
    expect(headers["x-api-key"]).toBe("org.key.secret");
    expect(headers.Authorization).toBeUndefined();
    expect(headers["User-Agent"]).toBe("ZCode/3.1.0");
    expect(headers["X-ZCode-App-Version"]).toBe("3.1.0");
    expect(headers["X-ZCode-Agent"]).toBe("glm");
    expect(headers["HTTP-Referer"]).toBe("https://zcode.z.ai/");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["X-Aliyun-Captcha-Verify-Param"]).toBe("captcha-token");
    expect(headers["X-Aliyun-Captcha-Verify-Region"]).toBeUndefined();
    expect(headers["Anthropic-Beta"]).toBeUndefined();
    expect(headers["x-session-id"]).toBeUndefined();
  });

  it("uses api.z.ai fallback URL without beta for API key only connections", () => {
    const apiKeyCreds = { apiKey: "org.key.secret" };
    expect(executor.buildUrl("glm-5.2", true, 0, apiKeyCreds)).toBe(
      "https://api.z.ai/api/anthropic/v1/messages"
    );
  });

  it("applies ZCode API key headers for API key only connections", () => {
    const headers = executor.buildHeaders({
      apiKey: "org.key.secret",
      providerSpecificData: { _captchaVerifyParam: "verify-abc" },
    });
    expect(headers["x-api-key"]).toBe("org.key.secret");
    expect(headers["X-Aliyun-Captcha-Verify-Param"]).toBe("verify-abc");
    expect(headers["User-Agent"]).toBe("ZCode/3.1.0");
    expect(headers["Anthropic-Beta"]).toBeUndefined();
    expect(headers["x-zcode-trace-id"]).toBeUndefined();
  });

  it("parses GLM 1113 quota errors into a readable message", () => {
    const parsed = executor.parseError(
      { status: 429 },
      JSON.stringify({
        type: "error",
        error: {
          type: "rate_limit_error",
          code: "1113",
          message: "[1113][Insufficient balance or no resource package. Please recharge.][req]",
        },
      })
    );
    expect(parsed.message).toContain("GLM quota exhausted");
    expect(parsed.message).not.toContain('{"type":"error"');
  });

  it("retries with API key fallback on 401 when apiKey is present", () => {
    withGlmRequest(codingPlanCreds, () => {
      expect(executor.shouldRetry(401, 0)).toBe(true);
      expect(executor.shouldRetry(401, 1)).toBe(false);
    });
  });

  it("exposes two URL fallbacks only within request scope for coding plan + api key", () => {
    withGlmRequest(codingPlanCreds, () => {
      expect(executor.getFallbackCount()).toBe(2);
    });
    expect(executor.getFallbackCount()).toBe(1);
  });

  it("maps glm-5.2 and applies ZCode system on coding plan URL", () => {
    const body = atUrlIndex(executor, 0, codingPlanCreds, () =>
      executor.transformRequest(
        "glm-5.2",
        {
          model: "glm-5.2",
          system: [{ type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." }],
          messages: [{ role: "user", content: "hi" }],
        },
        false,
        codingPlanCreds
      )
    );
    expect(body.model).toBe("GLM-5.2");
    expect(JSON.stringify(body.system)).toContain("You are ZCode");
    expect(JSON.stringify(body.system)).not.toContain("Claude Code");
  });
});