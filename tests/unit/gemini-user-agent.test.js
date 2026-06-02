import { afterEach, describe, expect, it, vi } from "vitest";
import { arch, platform } from "os";

function expectedSurface(surface) {
  return `GeminiCLI/0.34.0/gemini-2.5-pro (${platform()}; ${arch() === "ia32" ? "x86" : arch()}; ${surface})`;
}

describe("geminiCLIUserAgent", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("defaults to the terminal surface", async () => {
    const { geminiCLIUserAgent } = await import("../../open-sse/config/appConstants.js");
    expect(geminiCLIUserAgent("gemini-2.5-pro")).toBe(expectedSurface("terminal"));
  });

  it("honors GEMINI_CLI_SURFACE for custom identification", async () => {
    vi.stubEnv("GEMINI_CLI_SURFACE", "my-custom-tool");
    const { geminiCLIUserAgent } = await import("../../open-sse/config/appConstants.js");
    expect(geminiCLIUserAgent("gemini-2.5-pro")).toBe(expectedSurface("my-custom-tool"));
  });
});
