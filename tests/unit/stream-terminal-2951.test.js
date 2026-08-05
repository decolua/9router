import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  trackPendingRequest: vi.fn(),
}));
vi.mock("../../open-sse/services/usageTracker.js", () => ({ logUsage: vi.fn() }));

import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";

async function runStream(text) {
  const onStreamComplete = vi.fn();
  const source = new Response(text).body;
  const output = source.pipeThrough(createPassthroughStreamWithLogger(
    "nvidia", null, "model", "connection", {}, onStreamComplete,
  ));
  await new Response(output).text();
  return onStreamComplete.mock.calls[0][3];
}

describe("stream terminal lifecycle (#2951)", () => {
  it("reports incomplete when EOF arrives without a terminal event", async () => {
    await expect(runStream('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n')).resolves.toEqual({ terminalSeen: false });
  });

  it("reports completion when upstream sends [DONE]", async () => {
    await expect(runStream('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n')).resolves.toEqual({ terminalSeen: true });
  });
});
