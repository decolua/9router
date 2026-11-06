import { describe, it, expect } from "vitest";
import { spendMeta } from "../../open-sse/handlers/chatCore/requestDetail.js";
import { clientOf } from "../../src/lib/spendClient.js";

describe("spend attribution", () => {
  it("hashes the session and keeps combo, ua and real cost", () => {
    const m = spendMeta({ headers: { "user-agent": "claude-cli/2.1.318" }, session: "claude:abc", combo: "scout" }, { cost: 0.0123 });
    expect(m.ua).toBe("claude-cli/2.1.318");
    expect(m.session).toMatch(/^[0-9a-f]{12}$/);
    expect(m.session).not.toContain("abc");
    expect(m.combo).toBe("scout");
    expect(m.realCost).toBe(0.0123);
  });

  it("marks attribution even without a user-agent", () => {
    expect(spendMeta({ headers: {}, session: "s1" }, {}).ua).toBe("");
  });

  it("returns an empty object without a client request", () => {
    expect(spendMeta(null, {})).toEqual({});
  });

  it("maps user-agents to clients", () => {
    expect(clientOf("claude-cli/2.1.316")).toBe("Claude Code");
    expect(clientOf("codex-tui/0.9")).toBe("Codex");
    expect(clientOf("open-code-review/v1.13.0")).toBe("OpenCode Review");
    expect(clientOf("opencode/latest/2.2.5/cli")).toBe("OpenCode");
    expect(clientOf("T3")).toBe("T3 Code");
    expect(clientOf("")).toBe("Unknown");
  });
});
