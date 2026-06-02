import { describe, expect, it } from "vitest";

import { detectClientTool, isNativePassthrough } from "../../open-sse/utils/clientDetector.js";

describe("clientDetector", () => {
  it("recognizes both codex-cli and codex_cli_rs user agents as Codex", () => {
    expect(detectClientTool({ "user-agent": "codex-cli/0.135.0 (macOS; arm64)" })).toBe("codex");
    expect(detectClientTool({ "user-agent": "codex_cli_rs/0.135.0 (win32; x64)" })).toBe("codex");
  });

  it("keeps Codex as a native passthrough provider", () => {
    expect(isNativePassthrough("codex", "codex")).toBe(true);
    expect(isNativePassthrough("codex", "openai")).toBe(false);
  });
});
