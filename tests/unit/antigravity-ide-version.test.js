import { createRequire } from "module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  ANTIGRAVITY_IDE_VERSION,
  applyAntigravityIdeVersionOverride,
} = require("../../src/mitm/antigravityIdeVersion.js");

const CURRENT_VERSION = "2.11.0";

function makeRequest(metadata = { ideName: "antigravity", ideVersion: CURRENT_VERSION }) {
  const bodyBuffer = Buffer.from(JSON.stringify({ metadata, request: { contents: [] } }));
  const headers = {
    "content-type": "application/json",
    "content-length": String(bodyBuffer.length),
    "user-agent": `antigravity/${CURRENT_VERSION}`,
  };
  return { bodyBuffer, headers };
}

describe("Antigravity IDE version override", () => {
  it("preserves catalog request identity and bytes", () => {
    const { bodyBuffer, headers } = makeRequest();

    const result = applyAntigravityIdeVersionOverride(
      bodyBuffer,
      headers,
      "/v1internal:fetchAvailableModels"
    );

    expect(result.applied).toBe(false);
    expect(result.bodyBuffer).toBe(bodyBuffer);
    expect(result.headers).toBe(headers);
    expect(result.headers["user-agent"]).toBe(`antigravity/${CURRENT_VERSION}`);
    expect(JSON.parse(result.bodyBuffer.toString()).metadata.ideVersion).toBe(CURRENT_VERSION);
    expect(result.headers["content-length"]).toBe(String(bodyBuffer.length));
  });

  it.each([":generateContent", ":streamGenerateContent"])(
    "rewrites identity for %s requests",
    (endpoint) => {
      const { bodyBuffer, headers } = makeRequest();

      const result = applyAntigravityIdeVersionOverride(
        bodyBuffer,
        headers,
        `/v1internal/models/gemini-3.7-flash-tiered${endpoint}`
      );

      expect(result.applied).toBe(true);
      expect(result.bodyBuffer).not.toBe(bodyBuffer);
      expect(result.headers["user-agent"]).toBe(`antigravity/${ANTIGRAVITY_IDE_VERSION}`);
      expect(JSON.parse(result.bodyBuffer.toString()).metadata.ideVersion).toBe(ANTIGRAVITY_IDE_VERSION);
    }
  );

  it("preserves malformed non-generation request content byte-for-byte", () => {
    const bodyBuffer = Buffer.from([0xff, 0x00, 0x7b, 0x6e, 0x6f, 0x74, 0x2d, 0x6a, 0x73, 0x6f, 0x6e]);
    const headers = {
      "content-type": "application/octet-stream",
      "content-length": String(bodyBuffer.length),
      "user-agent": `antigravity/${CURRENT_VERSION}`,
    };

    const result = applyAntigravityIdeVersionOverride(bodyBuffer, headers, "/v1internal:loadCodeAssist");

    expect(result.applied).toBe(false);
    expect(result.bodyBuffer).toBe(bodyBuffer);
    expect(result.headers).toBe(headers);
  });

  it("does not synthesize missing Antigravity identity", () => {
    const bodyBuffer = Buffer.from(JSON.stringify({ metadata: {}, request: { contents: [] } }));
    const headers = { "content-type": "application/json", "content-length": String(bodyBuffer.length) };

    const result = applyAntigravityIdeVersionOverride(
      bodyBuffer,
      headers,
      "/v1internal/models/gemini-3.7-flash-tiered:generateContent"
    );

    expect(result.applied).toBe(false);
    expect(result.bodyBuffer).toBe(bodyBuffer);
    expect(result.headers).toEqual(headers);
    expect(result.headers).not.toHaveProperty("user-agent");
    expect(JSON.parse(result.bodyBuffer.toString()).metadata).not.toHaveProperty("ideVersion");
  });
});
