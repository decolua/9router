// Regression for #4986 / #4994 — the OpenCode free-tier fingerprint pass
// renames a colliding caller tool to an alias (read -> read_client). On the
// openai→openai path the chunk is forwarded as-is, so the alias reached the
// client and it answered
//   "Model tried to call unavailable tool 'read_client'".
//
// The rename map has to be handed to the passthrough stream explicitly: it has
// no format translation, so nothing else restores the caller's name.
import { describe, it, expect } from "vitest";

import { applyFingerprintTools, restoreToolNames } from "../../open-sse/utils/opencodeFingerprint.js";
import { createSSEStream, createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";

// A caller tool named `read` whose schema differs from OpenCode's fingerprint
// (the fingerprint uses path/offset/limit; this one uses filePath) — exactly
// the shape that triggers the rename.
const CALLER_TOOLS = [
  {
    type: "function",
    function: {
      name: "read",
      description: "Read a file the caller declared itself.",
      parameters: { type: "object", properties: { filePath: { type: "string" } } },
    },
  },
];

function bodyWithCallerRead() {
  return {
    messages: [{ role: "user", content: "read a.txt" }],
    tools: CALLER_TOOLS,
  };
}

async function drain(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

async function runPassthrough({ toolNameMap, toolName = "read_client" }) {
  const chunk = {
    id: "chatcmpl-abc12345",
    object: "chat.completion.chunk",
    created: 1700000000,
    model: "m",
    choices: [{
      index: 0,
      delta: {
        tool_calls: [{
          index: 0,
          id: "call_1",
          type: "function",
          function: { name: toolName, arguments: "{\"filePath\":\"a.txt\"}" },
        }],
      },
      finish_reason: null,
    }],
  };
  const sse = `data: ${JSON.stringify(chunk)}\n\n` + "data: [DONE]\n\n";

  const stream = createPassthroughStreamWithLogger("opencode", null, toolNameMap, "m", "c1");
  const writer = stream.writable.getWriter();
  const readPromise = drain(stream.readable);
  await writer.write(new TextEncoder().encode(sse));
  await writer.close();
  return readPromise;
}

describe("opencode fingerprint — tool name restore on the passthrough path", () => {
  it("renames a colliding caller tool to an alias", () => {
    const body = bodyWithCallerRead();
    const map = applyFingerprintTools(body, false);

    expect(map.get("read_client")).toBe("read");
    // The upstream sees the alias, not the caller's name.
    expect(body.tools.map((t) => t.function?.name)).toContain("read_client");
  });

  it("restores the caller's tool name in the passthrough stream", async () => {
    const body = bodyWithCallerRead();
    const map = applyFingerprintTools(body, false);

    const out = await runPassthrough({ toolNameMap: map });

    expect(out).not.toContain("read_client");
    expect(out).toContain('"name":"read"');
  });

  it("leaves a tool name the map does not cover alone", async () => {
    const out = await runPassthrough({ toolNameMap: new Map(), toolName: "read_client" });

    // No map → nothing to restore; the chunk is forwarded as-is.
    expect(out).toContain("read_client");
  });

  it("forwards the chunk untouched when there is no rename map", async () => {
    const out = await runPassthrough({ toolNameMap: null, toolName: "read" });

    expect(out).toContain('"name":"read"');
  });

  it("still restores the name in a translated (non-passthrough) stream", async () => {
    // Guards the existing behaviour: the format-translation path restores the
    // name on its own. The passthrough path is what was missing it.
    const map = new Map([["read_client", "read"]]);
    const chunk = {
      id: "chatcmpl-abc12345",
      object: "chat.completion.chunk",
      created: 1700000000,
      model: "m",
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            id: "call_1",
            type: "function",
            function: { name: "read_client", arguments: "{}" },
          }],
        },
        finish_reason: null,
      }],
    };

    const restored = restoreToolNames(chunk, map);
    expect(restored.choices[0].delta.tool_calls[0].function.name).toBe("read");
  });
});
