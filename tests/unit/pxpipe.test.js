import { describe, expect, it, vi } from "vitest";
import { compressWithPxpipe, formatPxpipeLog } from "../../open-sse/rtk/pxpipe.js";

const bigText = "x".repeat(30000);
const claudeBody = () => ({
  model: "claude-fable-5",
  max_tokens: 100,
  messages: [{ role: "user", content: bigText }],
});

// A transform double mimicking pxpipe-proxy/transform's contract.
const appliedTransform = (outBody) => async () => ({
  applied: true,
  reason: "applied",
  body: new TextEncoder().encode(JSON.stringify(outBody)),
  info: { compressedChars: 25000, imageCount: 2, imageBytes: 5000, imagePixels: 1500000 },
  cache: { ownsCacheControl: true, markerCount: 1 },
});

describe("compressWithPxpipe gates", () => {
  it("skips when disabled", async () => {
    const { body, summary } = await compressWithPxpipe(claudeBody(), { enabled: false });
    expect(body).toBeNull();
    expect(summary.reason).toBe("disabled");
  });

  it("skips when transform is unavailable (not installed)", async () => {
    const { body, summary } = await compressWithPxpipe(claudeBody(), { enabled: true, format: "claude", transform: null });
    expect(body).toBeNull();
    expect(summary.reason).toBe("not_installed");
  });

  it("skips non-Claude formats", async () => {
    const transform = vi.fn();
    const { body, summary } = await compressWithPxpipe(claudeBody(), { enabled: true, format: "openai", transform });
    expect(body).toBeNull();
    expect(summary.reason).toBe("unsupported_format");
    expect(transform).not.toHaveBeenCalled();
  });

  it("bypasses small prompts below minChars", async () => {
    const transform = vi.fn();
    const small = { model: "claude-fable-5", messages: [{ role: "user", content: "hi" }] };
    const { body, summary } = await compressWithPxpipe(small, { enabled: true, format: "claude", minChars: 25000, transform });
    expect(body).toBeNull();
    expect(summary.reason).toBe("below_threshold");
    expect(transform).not.toHaveBeenCalled();
  });

  it("applies the transform and reports savings", async () => {
    const compressed = { model: "claude-fable-5", messages: [{ role: "user", content: "imaged" }] };
    const { body, summary } = await compressWithPxpipe(claudeBody(), {
      enabled: true, format: "claude", minChars: 1000, transform: appliedTransform(compressed),
    });
    expect(body).toEqual(compressed);
    expect(summary.applied).toBe(true);
    expect(summary.imageCount).toBe(2);
    expect(summary.tokensBeforeEst).toBeGreaterThan(summary.tokensAfterEst);
    expect(summary.savedPct).toBeGreaterThan(0);
    expect(formatPxpipeLog(summary)).toContain("2 image(s)");
  });

  it("passes through when the transform declines (not_profitable)", async () => {
    const transform = async () => ({ applied: false, reason: "not_profitable", body: new Uint8Array(), info: {} });
    const { body, summary } = await compressWithPxpipe(claudeBody(), {
      enabled: true, format: "claude", minChars: 1000, transform,
    });
    expect(body).toBeNull();
    expect(summary.reason).toBe("not_profitable");
  });

  it("fails open when the transform throws", async () => {
    const transform = async () => { throw new Error("boom"); };
    const { body, summary } = await compressWithPxpipe(claudeBody(), {
      enabled: true, format: "claude", minChars: 1000, transform,
    });
    expect(body).toBeNull();
    expect(summary.reason).toBe("transform_error");
    expect(summary.detail).toBe("boom");
  });

  it("fails open on timeout", async () => {
    const transform = () => new Promise(() => {}); // never resolves
    const { body, summary } = await compressWithPxpipe(claudeBody(), {
      enabled: true, format: "claude", minChars: 1000, timeoutMs: 50, transform,
    });
    expect(body).toBeNull();
    expect(summary.reason).toBe("timeout");
  });

  it("does not log skipped requests as savings", () => {
    expect(formatPxpipeLog({ applied: false, reason: "below_threshold" })).toBeNull();
    expect(formatPxpipeLog(null)).toBeNull();
  });
});
