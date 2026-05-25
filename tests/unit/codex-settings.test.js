import { describe, expect, it } from "vitest";

import { buildCodexSubagentRole } from "../../src/app/api/cli-tools/codex-settings/config.js";

describe("Codex CLI settings", () => {
  it("writes a valid subagent role with required description", () => {
    expect(buildCodexSubagentRole("cx/gpt-5.5")).toEqual({
      description: "Fast subagent for codebase exploration",
      model: "cx/gpt-5.5",
    });
  });
});
