import { describe, expect, it } from "vitest";
import { stripAnsiCodes, parseSSELine } from "../../open-sse/utils/streamHelpers.js";

// ── stripAnsiCodes ───────────────────────────────────────────────────────────

describe("stripAnsiCodes", () => {
  it("strips CSI cursor-up / clear-line sequences (loading bar)", () => {
    expect(stripAnsiCodes("\x1b[2K\x1b[1Adata: hello")).toBe("data: hello");
  });

  it("strips SGR color codes", () => {
    expect(stripAnsiCodes("\x1b[31mred\x1b[0m")).toBe("red");
  });

  it("strips OSC sequences", () => {
    expect(stripAnsiCodes("\x1b]0;title\x07text")).toBe("text");
  });

  it("strips raw C0 control chars (except \\t \\n \\r)", () => {
    expect(stripAnsiCodes("\x00\x01\x08text\x0e\x1f")).toBe("text");
  });

  it("preserves normal printable text", () => {
    const text = 'data: {"choices":[{"delta":{"content":"hello"}}]}';
    expect(stripAnsiCodes(text)).toBe(text);
  });

  it("preserves tab, newline, carriage-return", () => {
    expect(stripAnsiCodes("a\tb\nc\rd")).toBe("a\tb\nc\rd");
  });

  it("returns empty string unchanged", () => {
    expect(stripAnsiCodes("")).toBe("");
  });

  it("handles null/undefined gracefully", () => {
    expect(stripAnsiCodes(null)).toBeNull();
    expect(stripAnsiCodes(undefined)).toBeUndefined();
  });
});

// ── parseSSELine with ANSI-prefixed lines ─────────────────────────────────────

describe("parseSSELine – ANSI prefix sanitization (gc/ issue #2273)", () => {
  it("parses a valid data line prefixed with cursor-clear ANSI codes", () => {
    const payload = JSON.stringify({ choices: [{ delta: { content: "hi" } }] });
    const line = `\x1b[2K\x1b[1Adata: ${payload}`;
    const result = parseSSELine(line);
    expect(result).not.toBeNull();
    expect(result.choices[0].delta.content).toBe("hi");
  });

  it("parses [DONE] line prefixed with ANSI codes", () => {
    const result = parseSSELine("\x1b[2Kdata: [DONE]");
    expect(result).toEqual({ done: true });
  });

  it("drops lines that are purely ANSI (no data payload)", () => {
    expect(parseSSELine("\x1b[2K\x1b[1A")).toBeNull();
  });

  it("still drops non-data lines without ANSI", () => {
    expect(parseSSELine("event: message")).toBeNull();
    expect(parseSSELine(": keep-alive")).toBeNull();
    expect(parseSSELine("")).toBeNull();
  });

  it("still parses normal data lines correctly (no regression)", () => {
    const payload = JSON.stringify({ id: "x", choices: [] });
    const result = parseSSELine(`data: ${payload}`);
    expect(result).not.toBeNull();
    expect(result.id).toBe("x");
  });
});
