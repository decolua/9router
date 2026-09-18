import { describe, it, expect } from "vitest";
import {
  applyFingerprintTools,
  concealFingerprintToolNames,
  appendMissingFingerprintTools,
  fingerprintToolKey,
  restoreToolNames,
  takeRenamedToolNames,
  OPENCODE_FINGERPRINT_TOOLS,
} from "open-sse/utils/opencodeFingerprint.js";

// The free-tier OpenCode Zen gate fingerprints its official client through the
// case of the file-search quartet. Measured against the upstream:
//   capitalised only        -> 403 FreeTierError
//   capitalised + lowercase -> 500 server_error (duplicates)
//   lowercase only          -> 200
// These tests pin the rename (not append) behaviour that avoids both.

const CC_TOOLS = ["Task", "Bash", "Glob", "Grep", "Read", "Edit", "Write", "WebFetch"];
const flat = (names) => names.map((n) => ({ type: "function", name: n }));
const chat = (names) => names.map((n) => ({ type: "function", function: { name: n } }));

describe("opencodeFingerprint — request side", () => {
  it("renames capitalised quartet members to lowercase", () => {
    const body = { tools: flat(CC_TOOLS) };
    const map = applyFingerprintTools(body, true);
    const names = body.tools.map((t) => t.name);

    expect(names).toContain("bash");
    expect(names).not.toContain("Bash");
    expect(names).toContain("Edit");
    expect(map.get("bash")).toBe("Bash");
  });

  it("never leaves a case-variant duplicate behind", () => {
    // Duplicates are what turn a 403 into a 500 upstream.
    const body = { tools: flat(CC_TOOLS) };
    applyFingerprintTools(body, true);

    const lower = body.tools.map((t) => t.name.toLowerCase());
    expect(new Set(lower).size).toBe(lower.length);
  });

  it("preserves tool count when renaming rather than appending", () => {
    const body = { tools: flat(CC_TOOLS) };
    applyFingerprintTools(body, true);
    expect(body.tools).toHaveLength(CC_TOOLS.length);
  });

  it("handles the nested chat shape without dropping .function", () => {
    const body = { tools: chat(CC_TOOLS) };
    applyFingerprintTools(body, false);

    const names = body.tools.map((t) => t.function.name);
    expect(names).toContain("bash");
    expect(names).not.toContain("Bash");
    expect(body.tools[1].function.name).toBe("bash");
  });

  it("drops pure duplicates", () => {
    const body = { tools: flat(["bash", "Bash", "Glob", "grep", "Read", "Edit"]) };
    applyFingerprintTools(body, true);

    const lower = body.tools.map((t) => t.name.toLowerCase());
    expect(new Set(lower).size).toBe(lower.length);
    // 4 unique quartet members + Edit
    expect(body.tools).toHaveLength(5);
  });

  it("injects the quartet when the body carries no tools at all", () => {
    // Measured: a request with no tools is also rejected with 403.
    const body = { tools: [] };
    applyFingerprintTools(body, true);

    expect(body.tools.map((t) => t.name).sort()).toEqual([...OPENCODE_FINGERPRINT_TOOLS].sort());
    for (const t of body.tools) expect(t.name).toBe(t.name.toLowerCase());
  });

  it("appends only the genuinely missing quartet members", () => {
    const body = { tools: flat(["Bash", "Read", "terminal"]) };
    applyFingerprintTools(body, true);

    const names = body.tools.map((t) => t.name);
    expect(names).toContain("glob");
    expect(names).toContain("grep");
    expect(names).toContain("terminal");
    expect(body.tools).toHaveLength(5);
  });

  it("retargets tool_choice that pointed at a renamed tool", () => {
    const body = { tools: flat(CC_TOOLS), tool_choice: { type: "tool", name: "Bash" } };
    applyFingerprintTools(body, true);
    expect(body.tool_choice.name).toBe("bash");
  });

  it("records the rename map against the body for the response side", () => {
    const body = { tools: flat(CC_TOOLS) };
    const map = applyFingerprintTools(body, true);
    expect(takeRenamedToolNames(body)).toBe(map);
  });

  it("never throws on malformed tools", () => {
    for (const tools of [null, undefined, "nope", [null, 42, []], [{}, { name: "" }]]) {
      expect(() => concealFingerprintToolNames(tools)).not.toThrow();
      expect(() => appendMissingFingerprintTools(tools, true)).not.toThrow();
    }
  });
});

describe("opencodeFingerprint — response side", () => {
  const map = new Map([["bash", "Bash"], ["grep", "Grep"], ["read", "Read"]]);

  it("restores names in Claude content_block_start chunks (streaming)", () => {
    const chunks = [
      { type: "content_block_start", content_block: { type: "tool_use", name: "bash", id: "t1" } },
      { type: "content_block_delta", delta: { type: "input_json_delta", partial_json: "{}" } },
    ];
    const out = restoreToolNames(chunks, map);

    expect(out[0].content_block.name).toBe("Bash");
    expect(out[1]).toBe(chunks[1]);
    // The original array must not be mutated — it may still be logged.
    expect(chunks[0].content_block.name).toBe("bash");
  });

  it("restores names in Claude non-streaming bodies", () => {
    const body = { type: "message", content: [{ type: "tool_use", name: "bash", input: {} }] };
    expect(restoreToolNames(body, map).content[0].name).toBe("Bash");
  });

  it("restores names in Chat Completions responses (message and delta)", () => {
    const body = {
      choices: [
        { message: { tool_calls: [{ function: { name: "grep", arguments: "{}" } }] } },
        { delta: { tool_calls: [{ function: { name: "read", arguments: "{}" } }] } },
      ],
    };
    const out = restoreToolNames(body, map);

    expect(out.choices[0].message.tool_calls[0].function.name).toBe("Grep");
    expect(out.choices[1].delta.tool_calls[0].function.name).toBe("Read");
  });

  it("restores names in Responses output items", () => {
    const body = { output: [{ type: "function_call", name: "bash", call_id: "c1" }] };
    expect(restoreToolNames(body, map).output[0].name).toBe("Bash");
  });

  it("is a no-op without a map or with an empty map", () => {
    const body = { choices: [{ message: { tool_calls: [{ function: { name: "bash" } }] } }] };
    expect(restoreToolNames(body, null)).toBe(body);
    expect(restoreToolNames(body, new Map())).toBe(body);
  });

  it("leaves unknown tool names untouched", () => {
    const body = { output: [{ type: "function_call", name: "Edit" }] };
    expect(restoreToolNames(body, map).output[0].name).toBe("Edit");
  });
});

describe("fingerprintToolKey", () => {
  it("maps case and whitespace variants, rejects everything else", () => {
    expect(fingerprintToolKey("Bash")).toBe("bash");
    expect(fingerprintToolKey(" bash ")).toBe("bash");
    expect(fingerprintToolKey("GLOB")).toBe("glob");
    expect(fingerprintToolKey("Read")).toBe("read");
    expect(fingerprintToolKey("Edit")).toBe("");
    expect(fingerprintToolKey("terminal")).toBe("");
    expect(fingerprintToolKey(null)).toBe("");
  });
});
