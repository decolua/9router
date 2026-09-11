import { describe, it, expect, beforeEach } from "vitest";
import {
  resolveProviderIconId,
  getProviderIconSrc,
  markProviderIconMissing,
} from "@/shared/utils/providerIcon";

describe("providerIcon — dynamic connection ids never request an icon file", () => {
  beforeEach(() => {
    // module-level Set persists between tests in the same file; reset via
    // re-importing is not needed since we only test deterministic behavior,
    // but keep a baseline by exercising known static ids first.
    getProviderIconSrc("anthropic"); // warm nothing; pure function
  });

  it("returns null src for an openai-compatible-chat connection with UUID suffix (bugfix: no 404 request)", () => {
    const id = "openai-compatible-chat-3414703e-903e-4da9-ade0-c8d3b27e2f11";
    expect(getProviderIconSrc(id)).toBeNull();
    expect(resolveProviderIconId(id)).toBe("");
  });

  it("returns null src for any dynamic connection id ending in a UUID", () => {
    const id = "anthropic-8c2f0c8e-1111-4222-8333-0f4a6c5b2d3e";
    expect(getProviderIconSrc(id)).toBeNull();
  });

  it("keeps static provider icons working", () => {
    expect(getProviderIconSrc("anthropic")).toBe("/providers/anthropic.png");
    expect(getProviderIconSrc("openai")).toBe("/providers/openai.png");
  });

  it("keeps alias resolution working", () => {
    expect(getProviderIconSrc("perplexity-agent")).toBe("/providers/perplexity.png");
  });

  it("keeps failedIds session-cache working for non-UUID ids", () => {
    markProviderIconMissing("mystery-provider");
    expect(getProviderIconSrc("mystery-provider")).toBeNull();
  });
});