import { describe, expect, it } from "vitest";

import {
  detectClientTool,
  isCodexClient,
  normalizeHeaders,
} from "../../open-sse/utils/clientDetector.js";

describe("Codex client detection", () => {
  it("detects classic codex-cli user-agent", () => {
    expect(detectClientTool({ "user-agent": "codex-cli/0.145.0" })).toBe("codex");
    expect(isCodexClient({ "User-Agent": "codex-cli/0.145.0" })).toBe(true);
  });

  it("detects codex_cli_rs / tui / vscode UA variants", () => {
    expect(detectClientTool({ "user-agent": "codex_cli_rs/0.145.0" })).toBe("codex");
    expect(detectClientTool({ "user-agent": "codex-tui/0.1" })).toBe("codex");
    expect(detectClientTool({ "user-agent": "codex_vscode/1.0" })).toBe("codex");
  });

  it("detects originator header from Codex Desktop", () => {
    expect(detectClientTool({ originator: "Codex Desktop" })).toBe("codex");
    expect(isCodexClient({ Originator: "Codex Desktop" })).toBe(true);
  });

  it("detects product sku header", () => {
    expect(detectClientTool({ "x-openai-product-sku": "codex" })).toBe("codex");
  });

  it("does not treat Claude / OpenCode / unknown as Codex", () => {
    expect(detectClientTool({ "user-agent": "claude-cli/1.0" })).toBe("claude");
    expect(isCodexClient({ "user-agent": "claude-cli/1.0" })).toBe(false);
    expect(detectClientTool({ "user-agent": "opencode/1.0" })).toBe(null);
    expect(isCodexClient({ "user-agent": "curl/8.0" })).toBe(false);
    expect(isCodexClient({})).toBe(false);
  });

  it("normalizeHeaders lowercases Fetch Headers", () => {
    const h = new Headers({ "User-Agent": "codex-cli/1", Originator: "Codex Desktop" });
    const n = normalizeHeaders(h);
    expect(n["user-agent"]).toBe("codex-cli/1");
    expect(n["originator"]).toBe("Codex Desktop");
  });
});
