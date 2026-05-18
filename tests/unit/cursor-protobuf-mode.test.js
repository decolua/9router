import { describe, it, expect } from "vitest";

import {
  generateCursorBody,
  parseConnectRPCFrame,
  decodeMessage,
  encodeField,
  encodeToolResult,
  extractTextFromResponse,
} from "../../open-sse/utils/cursorProtobuf.js";

// Field numbers mirrored from cursorProtobuf.js (kept local to avoid exporting internals)
const FIELD = {
  REQUEST: 1,
  IS_AGENTIC: 27,
  SUPPORTED_TOOLS: 29,
  UNIFIED_MODE: 46,
  SHOULD_DISABLE_TOOLS: 48,
  UNIFIED_MODE_NAME: 54,
};

const EXPECTED_NATIVE_TOOLS = [3, 4, 5, 6, 8, 10, 15, 18, 19, 20];

function decodeRequest(framed) {
  const frame = parseConnectRPCFrame(framed);
  if (!frame) throw new Error("ConnectRPC frame parse failed");
  const outer = decodeMessage(frame.payload);
  const requestField = outer.get(FIELD.REQUEST);
  if (!requestField) throw new Error("No REQUEST (field 1) in payload");
  return decodeMessage(requestField[0].value);
}

function readVarint(fields, fieldNum) {
  const entry = fields.get(fieldNum);
  return entry ? entry[0].value : undefined;
}

function readString(fields, fieldNum) {
  const entry = fields.get(fieldNum);
  return entry ? new TextDecoder().decode(entry[0].value) : undefined;
}

const baseMessages = [{ role: "user", content: "hello" }];

describe("cursor protobuf cursor_mode", () => {
  it("ask mode: enum=CHAT(1), name=\"Ask\", tools disabled", () => {
    const framed = generateCursorBody(baseMessages, "claude-4.5-sonnet", [], null, false, "ask");
    const req = decodeRequest(framed);
    expect(readVarint(req, FIELD.UNIFIED_MODE)).toBe(1);
    expect(readString(req, FIELD.UNIFIED_MODE_NAME)).toBe("Ask");
    expect(readVarint(req, FIELD.IS_AGENTIC)).toBe(0);
    expect(readVarint(req, FIELD.SHOULD_DISABLE_TOOLS)).toBe(1);
  });

  it("agent mode: enum=AGENT(2), name=\"Agent\", agentic", () => {
    const framed = generateCursorBody(baseMessages, "claude-4.5-sonnet", [], null, false, "agent");
    const req = decodeRequest(framed);
    expect(readVarint(req, FIELD.UNIFIED_MODE)).toBe(2);
    expect(readString(req, FIELD.UNIFIED_MODE_NAME)).toBe("Agent");
    expect(readVarint(req, FIELD.IS_AGENTIC)).toBe(1);
    expect(readVarint(req, FIELD.SHOULD_DISABLE_TOOLS)).toBe(0);
  });

  it("plan mode: enum=AGENT(2), name=\"Plan\", agentic", () => {
    const framed = generateCursorBody(baseMessages, "claude-4.5-sonnet", [], null, false, "plan");
    const req = decodeRequest(framed);
    expect(readVarint(req, FIELD.UNIFIED_MODE)).toBe(2);
    expect(readString(req, FIELD.UNIFIED_MODE_NAME)).toBe("Plan");
    expect(readVarint(req, FIELD.IS_AGENTIC)).toBe(1);
  });

  it("debug mode: enum=AGENT(2), name=\"Debug\", agentic", () => {
    const framed = generateCursorBody(baseMessages, "claude-4.5-sonnet", [], null, false, "debug");
    const req = decodeRequest(framed);
    expect(readVarint(req, FIELD.UNIFIED_MODE)).toBe(2);
    expect(readString(req, FIELD.UNIFIED_MODE_NAME)).toBe("Debug");
    expect(readVarint(req, FIELD.IS_AGENTIC)).toBe(1);
  });

  it("edit mode: enum=EDIT(3), name=\"Edit\"", () => {
    const framed = generateCursorBody(baseMessages, "claude-4.5-sonnet", [], null, false, "edit");
    const req = decodeRequest(framed);
    expect(readVarint(req, FIELD.UNIFIED_MODE)).toBe(3);
    expect(readString(req, FIELD.UNIFIED_MODE_NAME)).toBe("Edit");
    expect(readVarint(req, FIELD.IS_AGENTIC)).toBe(1);
  });

  it("custom mode: enum=CUSTOM(4), name=\"Custom\"", () => {
    const framed = generateCursorBody(baseMessages, "claude-4.5-sonnet", [], null, false, "custom");
    const req = decodeRequest(framed);
    expect(readVarint(req, FIELD.UNIFIED_MODE)).toBe(4);
    expect(readString(req, FIELD.UNIFIED_MODE_NAME)).toBe("Custom");
    expect(readVarint(req, FIELD.IS_AGENTIC)).toBe(1);
  });

  it("is case-insensitive (PLAN normalizes to plan)", () => {
    const framed = generateCursorBody(baseMessages, "claude-4.5-sonnet", [], null, false, "PLAN");
    const req = decodeRequest(framed);
    expect(readString(req, FIELD.UNIFIED_MODE_NAME)).toBe("Plan");
  });

  it("unknown mode falls back to default Agent", () => {
    const framed = generateCursorBody(baseMessages, "claude-4.5-sonnet", [], null, false, "nonsense");
    const req = decodeRequest(framed);
    expect(readVarint(req, FIELD.UNIFIED_MODE)).toBe(2);
    expect(readString(req, FIELD.UNIFIED_MODE_NAME)).toBe("Agent");
  });

  it("null cursor_mode → default Agent (no tools, no UA)", () => {
    const framed = generateCursorBody(baseMessages, "claude-4.5-sonnet", [], null, false, null);
    const req = decodeRequest(framed);
    expect(readVarint(req, FIELD.UNIFIED_MODE)).toBe(2);
    expect(readString(req, FIELD.UNIFIED_MODE_NAME)).toBe("Agent");
    expect(readVarint(req, FIELD.IS_AGENTIC)).toBe(1);
    expect(readVarint(req, FIELD.SHOULD_DISABLE_TOOLS)).toBe(0);
  });

  it("null cursor_mode + tools → default Agent", () => {
    const tools = [{
      type: "function",
      function: { name: "read_file", description: "x", parameters: { type: "object" } },
    }];
    const framed = generateCursorBody(baseMessages, "claude-4.5-sonnet", tools, null, false, null);
    const req = decodeRequest(framed);
    expect(readVarint(req, FIELD.UNIFIED_MODE)).toBe(2);
    expect(readString(req, FIELD.UNIFIED_MODE_NAME)).toBe("Agent");
  });

  it("null cursor_mode + forceAgentMode=true → default Agent", () => {
    const framed = generateCursorBody(baseMessages, "claude-4.5-sonnet", [], null, true, null);
    const req = decodeRequest(framed);
    expect(readVarint(req, FIELD.UNIFIED_MODE)).toBe(2);
    expect(readString(req, FIELD.UNIFIED_MODE_NAME)).toBe("Agent");
  });

  it("explicit ask overrides forceAgentMode", () => {
    const framed = generateCursorBody(baseMessages, "claude-4.5-sonnet", [], null, true, "ask");
    const req = decodeRequest(framed);
    expect(readVarint(req, FIELD.UNIFIED_MODE)).toBe(1);
    expect(readString(req, FIELD.UNIFIED_MODE_NAME)).toBe("Ask");
    expect(readVarint(req, FIELD.SHOULD_DISABLE_TOOLS)).toBe(1);
  });

  it("agent mode advertises native tool capabilities (field 29)", () => {
    const framed = generateCursorBody(baseMessages, "claude-4.5-sonnet", [], null, false, "agent");
    const req = decodeRequest(framed);
    const supTools = req.get(FIELD.SUPPORTED_TOOLS);
    expect(supTools).toBeTruthy();
    const bytes = Array.from(supTools[0].value);
    expect(bytes).toEqual(EXPECTED_NATIVE_TOOLS);
  });

  it("ask mode does NOT advertise native tools", () => {
    const framed = generateCursorBody(baseMessages, "claude-4.5-sonnet", [], null, false, "ask");
    const req = decodeRequest(framed);
    expect(req.get(FIELD.SUPPORTED_TOOLS)).toBeUndefined();
  });
});

// ---- apply_patch interception (Cursor server emits Bash+apply_patch which shell lacks)
describe("apply_patch interception", () => {
  const WIRE = { VARINT: 0, LEN: 2 };
  const F_RESP = {
    TOOL_CALL: 1,
    CV2C_TOOL: 1,
    TOOL_ID: 3,
    TOOL_NAME: 9,
    TOOL_IS_LAST: 11,
    TOOL_MCP_PARAMS: 27,
    MCP_TOOLS_LIST: 1,
    MCP_NESTED_NAME: 1,
    MCP_NESTED_PARAMS: 3,
    MCP_NESTED_SERVER: 4,
  };

  function concat(...arrays) {
    const total = arrays.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const a of arrays) { out.set(a, off); off += a.length; }
    return out;
  }

  function buildMcpBashResponse(command) {
    const argsJson = JSON.stringify({ command, description: "x" });
    const nested = concat(
      encodeField(F_RESP.MCP_NESTED_NAME, WIRE.LEN, "Bash"),
      encodeField(F_RESP.MCP_NESTED_PARAMS, WIRE.LEN, argsJson),
      encodeField(F_RESP.MCP_NESTED_SERVER, WIRE.LEN, "custom")
    );
    const mcpParams = encodeField(F_RESP.MCP_TOOLS_LIST, WIRE.LEN, nested);
    const msg = concat(
      encodeField(F_RESP.CV2C_TOOL, WIRE.VARINT, 19),
      encodeField(F_RESP.TOOL_ID, WIRE.LEN, "c1"),
      encodeField(F_RESP.TOOL_NAME, WIRE.LEN, "Bash"),
      encodeField(F_RESP.TOOL_IS_LAST, WIRE.VARINT, 1),
      encodeField(F_RESP.TOOL_MCP_PARAMS, WIRE.LEN, mcpParams)
    );
    return encodeField(F_RESP.TOOL_CALL, WIRE.LEN, msg);
  }

  it("rewrites apply_patch Update → Edit", () => {
    const cmd = `apply_patch <<'PATCH'\n*** Begin Patch\n*** Update File: test.md\n@@\n-# OOHH\n+# MMMM\n*** End Patch\nPATCH`;
    const r = extractTextFromResponse(new Uint8Array(buildMcpBashResponse(cmd)));
    expect(r.toolCall.function.name).toBe("Edit");
    const args = JSON.parse(r.toolCall.function.arguments);
    expect(args.file_path).toBe("test.md");
    expect(args.old_string).toBe("# OOHH");
    expect(args.new_string).toBe("# MMMM");
  });

  it("rewrites apply_patch Add File → Write", () => {
    const cmd = `apply_patch <<'PATCH'\n*** Begin Patch\n*** Add File: hello.txt\n+Hello\n+World\n*** End Patch\nPATCH`;
    const r = extractTextFromResponse(new Uint8Array(buildMcpBashResponse(cmd)));
    expect(r.toolCall.function.name).toBe("Write");
    const args = JSON.parse(r.toolCall.function.arguments);
    expect(args.file_path).toBe("hello.txt");
    expect(args.content).toBe("Hello\nWorld");
  });

  it("rewrites apply_patch Delete File → Bash rm", () => {
    const cmd = `apply_patch <<'PATCH'\n*** Begin Patch\n*** Delete File: obsolete.txt\n*** End Patch\nPATCH`;
    const r = extractTextFromResponse(new Uint8Array(buildMcpBashResponse(cmd)));
    expect(r.toolCall.function.name).toBe("Bash");
    const args = JSON.parse(r.toolCall.function.arguments);
    expect(args.command).toContain("rm -f");
    expect(args.command).toContain("obsolete.txt");
  });

  it("preserves context lines in Update hunks", () => {
    const cmd = `apply_patch <<'PATCH'\n*** Begin Patch\n*** Update File: app.js\n@@\n const x = 1;\n-const y = 2;\n+const y = 3;\n const z = 4;\n*** End Patch\nPATCH`;
    const r = extractTextFromResponse(new Uint8Array(buildMcpBashResponse(cmd)));
    const args = JSON.parse(r.toolCall.function.arguments);
    expect(args.old_string).toBe("const x = 1;\nconst y = 2;\nconst z = 4;");
    expect(args.new_string).toBe("const x = 1;\nconst y = 3;\nconst z = 4;");
  });

  it("leaves normal Bash commands untouched", () => {
    const r = extractTextFromResponse(new Uint8Array(buildMcpBashResponse("ls -la /tmp")));
    expect(r.toolCall.function.name).toBe("Bash");
    const args = JSON.parse(r.toolCall.function.arguments);
    expect(args.command).toBe("ls -la /tmp");
  });
});

describe("encodeToolResult MCP mapping", () => {
  const F = {
    TOOL_RESULT_NAME: 2,
    TOOL_RESULT_RESULT: 8,
    TOOL_RESULT_TOOL_CALL: 11,
    CV2R_MCP_RESULT: 28,
    MCPR_SELECTED_TOOL: 1,
    CV2C_MCP_PARAMS: 27,
    MCP_TOOLS_LIST: 1,
    MCP_TOOL_NAME: 1,
    MCP_TOOL_SERVER: 4,
  };

  const readString = (fields, num) => new TextDecoder().decode(fields.get(num)[0].value);

  it("preserves MCP server names with underscores", () => {
    const encoded = encodeToolResult({
      tool_name: "mcp__plugin_context7_context7__query-docs",
      tool_call_id: "call_123",
      raw_args: JSON.stringify({ query: "svelte" }),
      result_content: "ok",
      tool_index: 1,
    });

    const tr = decodeMessage(encoded);
    expect(readString(tr, F.TOOL_RESULT_NAME)).toBe("mcp_plugin_context7_context7_query-docs");

    const resultMsg = decodeMessage(tr.get(F.TOOL_RESULT_RESULT)[0].value);
    const mcpResult = decodeMessage(resultMsg.get(F.CV2R_MCP_RESULT)[0].value);
    expect(readString(mcpResult, F.MCPR_SELECTED_TOOL)).toBe("query-docs");

    const callMsg = decodeMessage(tr.get(F.TOOL_RESULT_TOOL_CALL)[0].value);
    const mcpParams = decodeMessage(callMsg.get(F.CV2C_MCP_PARAMS)[0].value);
    const mcpTool = decodeMessage(mcpParams.get(F.MCP_TOOLS_LIST)[0].value);
    expect(readString(mcpTool, F.MCP_TOOL_NAME)).toBe("query-docs");
    expect(readString(mcpTool, F.MCP_TOOL_SERVER)).toBe("plugin_context7_context7");
  });
});
