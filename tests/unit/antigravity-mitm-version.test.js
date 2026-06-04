import { describe, it, expect } from "vitest";

// CJS modules imported via await import
const antigravityIdeVersion = await import("../../src/mitm/antigravityIdeVersion.js");

describe("MITM Antigravity ideVersion override", () => {
  it("rewrites User-Agent and metadata ideVersion to the same shared version", () => {
    const bodyBuffer = Buffer.from(JSON.stringify({
      metadata: { ideName: "antigravity", ideVersion: "old" },
      request: { contents: [] }
    }));

    const result = antigravityIdeVersion.applyAntigravityIdeVersionOverride(bodyBuffer, {
      "user-agent": "antigravity/old linux/x64"
    });

    const parsed = JSON.parse(result.bodyBuffer.toString());

    expect(parsed.metadata.ideVersion).toBe(result.version);
    expect(result.headers["user-agent"]).toBe(`antigravity/${result.version} linux/x64`);
  });

  it("does not rewrite non-Antigravity User-Agent values", () => {
    expect(antigravityIdeVersion.rewriteAntigravityUserAgent("curl/8.0", "1.23.2")).toBe("curl/8.0");
  });
});
