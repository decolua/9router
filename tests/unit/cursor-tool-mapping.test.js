import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  toCursorToolName,
  fromCursorToolName,
  shouldForceAgentMode,
  parseNativeToolCallsFromText,
  getSupportedToolEnumsFromOpenAiTools,
} from "../../open-sse/utils/cursorToolMapping.js";

describe("cursorToolMapping", () => {
  it("maps OpenCode bash to Cursor shell", () => {
    assert.equal(toCursorToolName("bash"), "shell");
    assert.equal(fromCursorToolName("shell"), "bash");
  });

  it("maps list/glob aliases", () => {
    assert.equal(toCursorToolName("list"), "ls");
    assert.equal(toCursorToolName("glob"), "grep");
    assert.equal(fromCursorToolName("ls"), "list");
  });

  it("forces agent mode for OpenCode user agents", () => {
    assert.equal(shouldForceAgentMode("opencode/1.16.2"), true);
    assert.equal(shouldForceAgentMode("curl/8.0"), false);
  });

  it("maps native supported tool enums for bash", () => {
    const enums = getSupportedToolEnumsFromOpenAiTools([
      { type: "function", function: { name: "bash" } },
    ]);
    assert.equal(enums.includes(15), true);
  });

  it("parses native tool call text into OpenAI tool_calls", () => {
    const text = '<|tool_call_begin|>run_terminal_cmd {"command":"ls /tmp"}<|tool_call_end|>';
    const parsed = parseNativeToolCallsFromText(text);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].function.name, "bash");
    assert.match(parsed[0].function.arguments, /ls \/tmp/);
  });
});
