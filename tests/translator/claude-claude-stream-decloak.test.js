// Regression test: claude → claude streaming passthrough must still decloak
// tool names. translateRequest() remaps client tool names to TitleCase for
// OAuth-cloaked Claude providers (cloakToolsOnOAuth) even when source and
// target formats match; the same-format fast path in translateResponse() used
// to return chunks untouched, leaking the cloaked name (e.g. "RunCode") to
// the client, which then rejected the call as an unknown tool.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { CLAUDE_TOOL_SUFFIX } from "../../open-sse/config/appConstants.js";

const CLOAKED = "RunCode";
const LEGACY_CLOAKED = "run_code" + CLAUDE_TOOL_SUFFIX;

const toolUseStart = (name) => ({
  type: "content_block_start",
  index: 1,
  content_block: { type: "tool_use", id: "toolu_01XYZ", name, input: {} }
});

describe("Claude → Claude streaming passthrough (OAuth tool cloak)", () => {
  const state = { toolNameMap: new Map([[CLOAKED, "run_code"]]) };

  it("restores the original tool name on tool_use content_block_start", () => {
    const [out] = translateResponse(FORMATS.CLAUDE, FORMATS.CLAUDE, toolUseStart(CLOAKED), state);
    expect(out.content_block.name).toBe("run_code");
  });

  it("leaves uncloaked chunks untouched (identity passthrough)", () => {
    const chunk = toolUseStart("Bash"); // decoy name, not in the map
    const [out] = translateResponse(FORMATS.CLAUDE, FORMATS.CLAUDE, chunk, state);
    expect(out).toBe(chunk);

    const textChunk = { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } };
    const [outText] = translateResponse(FORMATS.CLAUDE, FORMATS.CLAUDE, textChunk, state);
    expect(outText).toBe(textChunk);
  });

  it("is a no-op for TitleCase names when no cloak map is present", () => {
    const chunk = toolUseStart(CLOAKED);
    const [out] = translateResponse(FORMATS.CLAUDE, FORMATS.CLAUDE, chunk, {});
    expect(out).toBe(chunk);
  });

  it("falls back to stripping legacy *_ide suffix when no cloak map is present", () => {
    const chunk = toolUseStart(LEGACY_CLOAKED);
    const [out] = translateResponse(FORMATS.CLAUDE, FORMATS.CLAUDE, chunk, {});
    expect(out.content_block.name).toBe("run_code");
  });

  it("tolerates the null flush chunk", () => {
    const [out] = translateResponse(FORMATS.CLAUDE, FORMATS.CLAUDE, null, state);
    expect(out).toBeNull();
  });
});
