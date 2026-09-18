// Regression test for the routing half of the same-format OAuth cloak bug.
//
// translateRequest() cloaks client tool names with CLAUDE_TOOL_SUFFIX even on
// claude -> claude requests (cloakToolsOnOAuth providers), and
// decloakStreamChunk() in translateResponse() restores them. But before this
// fix buildTransformStream() picked the raw passthrough stream whenever
// needsTranslation() was false, so translateResponse() never ran and the
// client received the cloaked name ("Model tried to call unavailable tool
// 'bash_ide'"). The sibling tests in tests/translator call translateResponse()
// directly, so they cannot catch this regression.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";

vi.mock("../../open-sse/utils/stream.js", () => ({
  createSSETransformStreamWithLogger: vi.fn(() => ({ kind: "transform" })),
  createPassthroughStreamWithLogger: vi.fn(() => ({ kind: "passthrough" })),
}));

import { buildTransformStream } from "../../open-sse/handlers/chatCore/streamingHandler.js";
import { createSSETransformStreamWithLogger, createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";

describe("buildTransformStream same-format decloak routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes claude -> claude through the translate pipeline when a toolNameMap is present", () => {
    const stream = buildTransformStream({
      provider: "claude",
      sourceFormat: FORMATS.CLAUDE,
      targetFormat: FORMATS.CLAUDE,
      toolNameMap: new Map([["bash_ide", "bash"]]),
      body: {},
    });
    expect(stream).toEqual({ kind: "transform" });
    expect(createSSETransformStreamWithLogger).toHaveBeenCalledTimes(1);
    expect(createPassthroughStreamWithLogger).not.toHaveBeenCalled();
  });

  it("keeps the passthrough stream when no toolNameMap is present", () => {
    const stream = buildTransformStream({
      provider: "claude",
      sourceFormat: FORMATS.CLAUDE,
      targetFormat: FORMATS.CLAUDE,
      body: {},
    });
    expect(stream).toEqual({ kind: "passthrough" });
    expect(createPassthroughStreamWithLogger).toHaveBeenCalledTimes(1);
    expect(createSSETransformStreamWithLogger).not.toHaveBeenCalled();
  });

  it("keeps the passthrough stream for an empty toolNameMap", () => {
    const stream = buildTransformStream({
      provider: "claude",
      sourceFormat: FORMATS.CLAUDE,
      targetFormat: FORMATS.CLAUDE,
      toolNameMap: new Map(),
      body: {},
    });
    expect(stream).toEqual({ kind: "passthrough" });
    expect(createPassthroughStreamWithLogger).toHaveBeenCalledTimes(1);
  });
});
