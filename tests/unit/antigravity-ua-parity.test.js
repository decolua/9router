// One version constant, one UA builder, shape-preserving MITM rewrite.
// The MITM module is CJS and is the owner; the ESM shared.js side must import it.
import { createRequire } from "module";
import { describe, expect, it } from "vitest";
import {
  ANTIGRAVITY_IDE_USER_AGENT,
  ANTIGRAVITY_IDE_VERSION,
} from "../../open-sse/providers/shared.js";
import antigravity from "../../open-sse/providers/registry/antigravity.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";

const require = createRequire(import.meta.url);
const mitm = require("../../src/mitm/antigravityIdeVersion.js");

const EXPECTED_VERSION = "2.34.0";

describe("Antigravity UA parity", () => {
  it("replaces the version on a Hub UA and keeps hub/ plus the platform suffix", () => {
    expect(mitm.rewriteAntigravityUserAgent("antigravity/hub/2.24.0 darwin/arm64", "9.9.9"))
      .toBe("antigravity/hub/9.9.9 darwin/arm64");
  });

  it("replaces the version on a bare UA and keeps the bare shape", () => {
    expect(mitm.rewriteAntigravityUserAgent("antigravity/2.22.0", "9.9.9"))
      .toBe("antigravity/9.9.9");
  });

  it("replaces the version on a bare UA and preserves the platform suffix", () => {
    expect(mitm.rewriteAntigravityUserAgent("antigravity/2.22.0 darwin/arm64", "9.9.9"))
      .toBe("antigravity/9.9.9 darwin/arm64");
  });

  it("leaves a non-Antigravity UA untouched", () => {
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
    expect(mitm.rewriteAntigravityUserAgent(ua, "9.9.9")).toBe(ua);
  });

  it("builds the Hub UA as antigravity/hub/<version> darwin/arm64", () => {
    expect(mitm.buildAntigravityUserAgent("9.9.9")).toBe("antigravity/hub/9.9.9 darwin/arm64");
  });

  it("keeps the version and the executor UA on one source", () => {
    expect(ANTIGRAVITY_IDE_VERSION).toBe(mitm.ANTIGRAVITY_IDE_VERSION);
    expect(ANTIGRAVITY_IDE_VERSION).toBe(EXPECTED_VERSION);
    expect(ANTIGRAVITY_IDE_USER_AGENT).toBe(mitm.buildAntigravityUserAgent(mitm.ANTIGRAVITY_IDE_VERSION));
    expect(ANTIGRAVITY_IDE_USER_AGENT).toBe(`antigravity/hub/${EXPECTED_VERSION} darwin/arm64`);
  });

  it("executor and registry both emit the single-source UA", () => {
    const executor = new AntigravityExecutor();
    const headers = executor.buildHeaders({ accessToken: "tok" }, true);

    expect(antigravity.transport.headers["User-Agent"]).toBe(ANTIGRAVITY_IDE_USER_AGENT);
    expect(antigravity.oauth.loadCodeAssistUserAgent).toBe(ANTIGRAVITY_IDE_USER_AGENT);
    expect(headers["User-Agent"]).toBe(ANTIGRAVITY_IDE_USER_AGENT);
  });

  it("streaming calls send Accept: text/event-stream", () => {
    const executor = new AntigravityExecutor();
    expect(executor.buildHeaders({ accessToken: "tok" }, true)["Accept"]).toBe("text/event-stream");
  });

  it("non-streaming calls send no Accept header", () => {
    const executor = new AntigravityExecutor();
    expect(executor.buildHeaders({ accessToken: "tok" }, false)).not.toHaveProperty("Accept");
  });
});
