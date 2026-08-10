import { describe, it, expect, vi, afterEach } from "vitest";
import os from "os";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { ANTIGRAVITY_IDE_USER_AGENT } from "../../open-sse/providers/shared.js";
import { getPlatformEnum, PLATFORM } from "../../open-sse/config/appConstants.js";
import { getOAuthClientMetadata } from "../../src/lib/oauth/constants/oauth.js";

describe("Antigravity Static Footprint", () => {
  it("should use static darwin/arm64 platform enum for OAuth metadata", () => {
    const metadata = getOAuthClientMetadata();
    expect(metadata.platform).toBe(2); // PLATFORM.DARWIN_ARM64
  });

  it("should use static darwin/arm64 platform enum in appConstants", () => {
    expect(getPlatformEnum()).toBe(PLATFORM.DARWIN_ARM64);
  });

  it("executor should generate headers with static darwin/arm64 user agent and metadata", () => {
    const executor = new AntigravityExecutor();
    const headers = executor.buildHeaders({ accessToken: "fake-token" });
    
    expect(headers["User-Agent"]).toBe(ANTIGRAVITY_IDE_USER_AGENT);
    expect(headers["User-Agent"]).toBe("antigravity/ide/2.1.1 darwin/arm64");
    
    const clientMetadata = JSON.parse(headers["Client-Metadata"]);
    expect(clientMetadata.platform).toBe(PLATFORM.DARWIN_ARM64);
  });
});

describe("Cross-Environment Simulation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should maintain darwin/arm64 footprint even if running on Linux AMD64", () => {
    // Simulate Linux x64
    vi.spyOn(os, "platform").mockReturnValue("linux");
    vi.spyOn(os, "arch").mockReturnValue("x64");
    
    const executor = new AntigravityExecutor();
    const headers = executor.buildHeaders({ accessToken: "fake-token" });
    
    expect(headers["User-Agent"]).toBe("antigravity/ide/2.1.1 darwin/arm64");
    
    const clientMetadata = JSON.parse(headers["Client-Metadata"]);
    expect(clientMetadata.platform).toBe(PLATFORM.DARWIN_ARM64);
    
    // Also test oauth metadata
    const metadata = getOAuthClientMetadata();
    expect(metadata.platform).toBe(PLATFORM.DARWIN_ARM64);
  });

  it("should maintain darwin/arm64 footprint even if running on Windows", () => {
    // Simulate Windows x64
    vi.spyOn(os, "platform").mockReturnValue("win32");
    vi.spyOn(os, "arch").mockReturnValue("x64");
    
    const executor = new AntigravityExecutor();
    const headers = executor.buildHeaders({ accessToken: "fake-token" });
    
    expect(headers["User-Agent"]).toBe("antigravity/ide/2.1.1 darwin/arm64");
    
    const clientMetadata = JSON.parse(headers["Client-Metadata"]);
    expect(clientMetadata.platform).toBe(PLATFORM.DARWIN_ARM64);
  });
});
