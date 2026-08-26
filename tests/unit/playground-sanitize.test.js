import { describe, expect, it } from "vitest";
import { sanitizePlaygroundData } from "../../src/app/(dashboard)/dashboard/playground/lib/sanitize.js";

const REDACTED = "[REDACTED]";

function serialized(value) {
  return JSON.stringify(value);
}

describe("sanitizePlaygroundData", () => {
  it("preserves ordinary client-visible model, status, metric, and output fields", () => {
    const input = {
      model: "test-provider/test-model",
      status: "complete",
      durationMs: 1240,
      ttftMs: 112,
      usage: { prompt_tokens: 10, completion_tokens: 5 },
      output: "The sky is blue because molecules scatter blue light.",
    };

    expect(sanitizePlaygroundData(input)).toEqual(input);
  });

  it("recursively redacts headers, credential-bearing URLs, and secret-like fields", () => {
    const input = {
      request: {
        headers: {
          Authorization: "Bearer sk-secret-value",
          Cookie: "auth_token=session-secret",
          "X-Request-Id": "safe-request-id",
        },
        endpoint: "https://user:password@example.com/path?token=secret",
        nested: [{ accessToken: "unknown-secret-value" }],
      },
      response: {
        status: 401,
        details: ["Bearer sk-secret-value", { apiKey: "unknown-secret-value" }],
      },
    };

    const output = sanitizePlaygroundData(input);

    expect(output).toEqual({
      request: {
        headers: {
          Authorization: REDACTED,
          Cookie: REDACTED,
          "X-Request-Id": "safe-request-id",
        },
        endpoint: REDACTED,
        nested: [{ accessToken: REDACTED }],
      },
      response: {
        status: 401,
        details: [REDACTED, { apiKey: REDACTED }],
      },
    });
    expect(serialized(output)).not.toContain("sk-secret-value");
    expect(serialized(output)).not.toContain("session-secret");
    expect(serialized(output)).not.toContain("user:password");
    expect(serialized(output)).not.toContain("unknown-secret-value");
  });

  it("removes control characters and bounds strings, nesting, and arrays", () => {
    const deeplyNested = { level: 0 };
    let current = deeplyNested;
    for (let level = 1; level < 12; level += 1) {
      current.child = { level };
      current = current.child;
    }

    const output = sanitizePlaygroundData({
      message: `Line one\u0000\nLine two${"x".repeat(3000)}`,
      deeplyNested,
      items: Array.from({ length: 120 }, (_, index) => index),
    });

    expect(output.message).not.toMatch(/[\u0000-\u001F\u007F]/);
    expect(output.message.endsWith("...")).toBe(true);
    expect(output.message.length).toBeLessThanOrEqual(1024);
    expect(output.items).toHaveLength(50);
    expect(output.items.at(-1)).toBe("[TRUNCATED]");

    let depth = 0;
    let value = output.deeplyNested;
    while (value && typeof value === "object" && value.child) {
      depth += 1;
      value = value.child;
    }
    expect(depth).toBeLessThanOrEqual(6);
    expect(serialized(output)).toContain("[TRUNCATED]");
  });

  it("does not mutate the source payload", () => {
    const input = { headers: { authorization: "Bearer sk-secret-value" } };

    const output = sanitizePlaygroundData(input);

    expect(output).not.toBe(input);
    expect(output.headers).not.toBe(input.headers);
    expect(input.headers.authorization).toBe("Bearer sk-secret-value");
  });
});
