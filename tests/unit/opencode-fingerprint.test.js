import { describe, it, expect } from "vitest";
import {
  applyFingerprintTools,
  applyEnvFingerprint,
  concealFingerprintToolNames,
  appendMissingFingerprintTools,
  fingerprintToolKey,
  restoreToolNames,
  takeRenamedToolNames,
  OPENCODE_FINGERPRINT_TOOLS,
} from "open-sse/utils/opencodeFingerprint.js";

const CC_TOOLS = ["Task", "Bash", "Glob", "Grep", "Read", "Edit", "Write", "WebFetch"];
const flat = (names) => names.map((name) => ({ type: "function", name }));
const chat = (names) => names.map((name) => ({ type: "function", function: { name } }));
const namesOf = (tools) => tools.map((tool) => tool.name ?? tool.function?.name);
const ENV_PROBE = "Here is some useful information about the environment you are running in:";

describe("opencodeFingerprint — request side", () => {
  it("appends exact read/shell definitions and leaves case variants untouched", () => {
    const body = { tools: flat(CC_TOOLS) };
    const map = applyFingerprintTools(body, true);

    expect(namesOf(body.tools)).toEqual([...CC_TOOLS, ...OPENCODE_FINGERPRINT_TOOLS]);
    expect(map.size).toBe(0);
    const shell = body.tools.find((tool) => tool.name === "shell");
    expect(shell.description).toMatch(/^Execute a shell command/);
    expect(shell.parameters.required).toEqual(["command"]);
    expect(shell.strict).toBe(false);
  });

  it("handles the nested chat shape without dropping .function", () => {
    const body = { tools: chat(["Edit"]) };
    applyFingerprintTools(body, false);

    expect(namesOf(body.tools)).toEqual(["Edit", "read", "shell"]);
    const read = body.tools.find((tool) => tool.function?.name === "read");
    expect(read.function.parameters.required).toEqual(["path"]);
  });

  it("aliases a caller tool that reuses an exact fingerprint name", () => {
    const body = { tools: flat(["read", "read_client", "Edit"]) };
    const map = applyFingerprintTools(body, true);

    expect(namesOf(body.tools)).toEqual(["read_client2", "read_client", "Edit", "read", "shell"]);
    expect(map.get("read_client2")).toBe("read");
  });

  it("keeps a caller tool that already carries OpenCode's exact definition", () => {
    const first = { tools: [] };
    applyFingerprintTools(first, true);
    const official = first.tools.map((tool) => ({ ...tool }));

    const body = { tools: official };
    const map = applyFingerprintTools(body, true);
    expect(namesOf(body.tools)).toEqual(OPENCODE_FINGERPRINT_TOOLS);
    expect(map.size).toBe(0);
    expect(body.instructions).toContain("<env>");
  });

  it("drops duplicate declarations of one fingerprint name", () => {
    const body = { tools: flat(["shell", "shell"]) };
    applyFingerprintTools(body, true);
    expect(namesOf(body.tools)).toEqual(["shell_client", "read", "shell"]);
  });

  it("defaults Responses tool_choice to auto and never to none for chat", () => {
    const responses = { tools: [] };
    applyFingerprintTools(responses, true);
    expect(responses.tool_choice).toBe("auto");

    const chatBody = { messages: [{ role: "user", content: "hi" }] };
    applyFingerprintTools(chatBody, false);
    expect(namesOf(chatBody.tools)).toEqual(OPENCODE_FINGERPRINT_TOOLS);
    expect(chatBody.tool_choice).toBeUndefined();
  });

  it("tells the model the appended tools are placeholders", () => {
    const responses = { instructions: "Be brief.", tools: [] };
    applyFingerprintTools(responses, true);
    expect(responses.instructions).toMatch(/^Be brief\.\n\nDo not call the `read` or `shell` tools;/);

    const chatBody = { messages: [{ role: "system", content: "Be brief." }, { role: "user", content: "hi" }] };
    applyFingerprintTools(chatBody, false);
    expect(chatBody.messages).toHaveLength(2);
    expect(chatBody.messages[0].content).toMatch(/^Be brief\.\n\nDo not call the `read` or `shell` tools;/);

    const noSystem = { messages: [{ role: "user", content: "hi" }] };
    applyFingerprintTools(noSystem, false);
    expect(noSystem.messages[0]).toEqual({ role: "system", content: expect.stringMatching(/^Do not call/) });

    const claudeShape = { system: "Be brief.", messages: [{ role: "user", content: "hi" }] };
    applyFingerprintTools(claudeShape, false);
    expect(claudeShape.messages).toHaveLength(1);
  });

  it("retargets flat tool_choice that points at an aliased tool", () => {
    const body = { tools: flat(["shell"]), tool_choice: { type: "function", name: "shell" } };
    applyFingerprintTools(body, true);
    expect(body.tool_choice.name).toBe("shell_client");
  });

  it("retargets nested tool_choice that points at an aliased tool", () => {
    const body = {
      tools: chat(["read"]),
      tool_choice: { type: "function", function: { name: "read" } },
    };
    applyFingerprintTools(body, false);
    expect(body.tool_choice.function.name).toBe("read_client");
  });

  it("records the rename map against the body for the response side", () => {
    const body = { tools: flat(["read"]) };
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

  it("restores names in Claude content_block_start chunks", () => {
    const chunk = {
      type: "content_block_start",
      content_block: { type: "tool_use", name: "bash", id: "t1" },
    };
    const out = restoreToolNames(chunk, map);

    expect(out.content_block.name).toBe("Bash");
    expect(chunk.content_block.name).toBe("bash");
  });

  it("recursively restores streaming chunks inside arrays", () => {
    const chunks = [{
      choices: [{ delta: { tool_calls: [{ function: { name: "grep", arguments: "{}" } }] } }],
    }];
    const out = restoreToolNames(chunks, map);
    expect(out[0].choices[0].delta.tool_calls[0].function.name).toBe("Grep");
  });

  it("restores names in Claude non-streaming bodies", () => {
    const body = { type: "message", content: [{ type: "tool_use", name: "bash", input: {} }] };
    expect(restoreToolNames(body, map).content[0].name).toBe("Bash");
  });

  it("restores names in Chat Completions message and delta shapes", () => {
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

  it("restores names in Responses final output items", () => {
    const body = { output: [{ type: "function_call", name: "bash", call_id: "c1" }] };
    expect(restoreToolNames(body, map).output[0].name).toBe("Bash");
  });

  it("restores names in Responses streaming output_item events", () => {
    const event = {
      type: "response.output_item.added",
      item: { type: "function_call", name: "read", call_id: "c1" },
    };
    expect(restoreToolNames(event, map).item.name).toBe("Read");
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
  it("matches exact fingerprint names only", () => {
    expect(fingerprintToolKey("read")).toBe("read");
    expect(fingerprintToolKey(" shell ")).toBe("shell");
    expect(fingerprintToolKey("Read")).toBe("");
    expect(fingerprintToolKey("bash")).toBe("");
    expect(fingerprintToolKey("terminal")).toBe("");
    expect(fingerprintToolKey(null)).toBe("");
  });
});

describe("opencodeFingerprint — env marker", () => {
  const inBlock = (text) => {
    const start = text.indexOf("<env>");
    expect(start).toBeGreaterThanOrEqual(0);
    const end = text.indexOf("</env>", start);
    expect(end).toBeGreaterThan(start);
    return text.slice(start, end);
  };

  it("appends the marker to Responses instructions", () => {
    const body = { instructions: "Be terse.", tools: [] };
    applyFingerprintTools(body, true);

    expect(body.instructions.startsWith("Be terse.\n\n")).toBe(true);
    expect(body.instructions).toContain("Here is some useful information about the environment you are running in:");
    const block = inBlock(body.instructions);
    expect(block).toMatch(/\n  Working directory: \S/);
    expect(block).toMatch(/\n  Workspace root folder: \S/);
    expect(block).toMatch(/\n  Platform: [a-z0-9_]+/);
  });

  it("creates Responses instructions that lack one", () => {
    const body = { tools: [] };
    applyFingerprintTools(body, true);
    expect(body.instructions).toContain(ENV_PROBE);
  });

  it("appends the marker to an existing chat system message", () => {
    const body = { messages: [{ role: "system", content: "Be brief." }, { role: "user", content: "hi" }] };
    applyFingerprintTools(body, false);

    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].content).toContain("Be brief.");
    expect(body.messages[0].content).toContain(ENV_PROBE);
    expect(body.messages[1]).toEqual({ role: "user", content: "hi" });
  });

  it("prepends a system message when chat has none", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    applyFingerprintTools(body, false);

    expect(body.messages[0]).toEqual({
      role: "system",
      content: expect.stringContaining(ENV_PROBE),
    });
    expect(body.messages[1]).toEqual({ role: "user", content: "hi" });
  });

  it("appends a text block to a chat system message with array content", () => {
    const body = {
      messages: [{ role: "system", content: [{ type: "text", text: "Rules here." }] }, { role: "user", content: "hi" }],
    };
    applyFingerprintTools(body, false);

    // The placeholder note goes into its own prepended system message and the
    // marker lands in the first system message; the caller's array content is
    // preserved untouched.
    expect(body.messages).toHaveLength(3);
    expect(body.messages[0].content).toContain(ENV_PROBE);
    expect(body.messages[1].content[0].text).toBe("Rules here.");
    expect(body.messages[2]).toEqual({ role: "user", content: "hi" });
  });

  it("appends the marker to a claude-shaped body.system string", () => {
    const body = { system: "Be brief.", messages: [{ role: "user", content: "hi" }] };
    applyFingerprintTools(body, false);

    expect(body.system).toContain("Be brief.");
    expect(body.system).toContain(ENV_PROBE);
    expect(body.messages).toHaveLength(1);
  });

  it("creates a claude top-level system instead of a role:system message", () => {
    const body = {
      max_tokens: 1024,
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    };
    applyFingerprintTools(body, false, { claude: true });

    // /messages rejects messages with role:"system"; the marker (and the
    // placeholder note) must live on the optional top-level `system`.
    const systemText = typeof body.system === "string"
      ? body.system
      : body.system.map((block) => block?.text ?? "").join("\n");
    expect(systemText).toContain(ENV_PROBE);
    expect(systemText).toMatch(/Do not call the `read` or `shell` tools;/);
    if (Array.isArray(body.messages)) {
      expect(body.messages.some((msg) => msg?.role === "system")).toBe(false);
    }
    expect(body.messages.filter((msg) => msg?.role === "user")).toHaveLength(1);
  });

  it("appends the marker to the last text block of a claude-shaped system array", () => {
    const body = {
      system: [{ type: "text", text: "sys one" }, { type: "text", text: "sys two" }],
      messages: [{ role: "user", content: "hi" }],
    };
    applyFingerprintTools(body, false);

    expect(body.system[0].text).toBe("sys one");
    expect(body.system[1].text).toContain("sys two");
    expect(body.system[1].text).toContain(ENV_PROBE);
  });

  it("stays byte-for-byte for a body that already carries its own <env> block", () => {
    const instructions = "You are OpenCode.\n\nHere is some useful information about the environment you are running in:\n<env>\n  Working directory: /home/dev/proj\n  Workspace root folder: /home/dev\n</env>";
    const chatContent = "Be brief.\n\n<env>\n  Working directory: /home/dev/proj\n</env>";
    // A genuine client also ships its own tools, so nothing gets appended.
    const passthroughTools = (flat) => {
      const seed = { tools: [] };
      applyFingerprintTools(seed, flat);
      return JSON.parse(JSON.stringify(seed.tools));
    };

    const flatBody = { instructions, tools: passthroughTools(true) };
    applyFingerprintTools(flatBody, true);
    expect(flatBody.instructions).toBe(instructions);

    const chatBody = {
      messages: [{ role: "system", content: chatContent }, { role: "user", content: "hi" }],
      tools: passthroughTools(false),
    };
    applyFingerprintTools(chatBody, false);
    expect(chatBody.messages[0].content).toBe(chatContent);
  });

  it("applyEnvFingerprint is idempotent across calls", () => {
    const body = { messages: [{ role: "system", content: "Once.", }, { role: "user", content: "hi" }] };
    expect(applyEnvFingerprint(body, false)).toBe(true);
    const once = body.messages[0].content;
    expect(applyEnvFingerprint(body, false)).toBe(false);
    expect(body.messages[0].content).toBe(once);
  });

  it("never throws on malformed bodies", () => {
    expect(() => applyEnvFingerprint(null, false)).not.toThrow();
    expect(() => applyEnvFingerprint(undefined, true)).not.toThrow();
    expect(() => applyEnvFingerprint("nope", false)).not.toThrow();
    expect(applyEnvFingerprint(null, false)).toBe(false);
  });
});

describe("opencodeFingerprint — platform shell wordings", () => {
  const SHELL_TAIL = "Quote file paths containing spaces or special characters. Prefer dedicated tools over shell commands when possible. When output is large, the full result is saved to a file and a truncated preview is returned. Rely on automatic truncation unless filtering the output is more useful. Commands accept an optional timeout, background commands have no timeout by default. Background commands return immediately, and you will be notified when they complete.";

  const canonicalShellParameters = () => {
    const body = { tools: [] };
    applyFingerprintTools(body, true);
    return body.tools.find((tool) => tool.name === "shell").parameters;
  };

  const callerShellWith = (wording, parameters) => ({
    type: "function",
    function: {
      name: "shell",
      description: `Execute a shell command and return its output. Commands run on ${wording}. ${SHELL_TAIL}`,
      parameters: parameters ?? canonicalShellParameters(),
    },
  });

  const officialShellTool = (flat) => {
    const seed = { tools: [] };
    applyFingerprintTools(seed, flat);
    return JSON.parse(JSON.stringify(
      flat ? seed.tools.find((tool) => tool.name === "shell") : seed.tools.find((tool) => tool.function?.name === "shell")
    ));
  };

  it("keeps a caller shell whose definition matches the current form", () => {
    const body = { tools: [officialShellTool(false)] };
    const map = applyFingerprintTools(body, false);

    // The regenerated fingerprint wording matches whatever platform this host
    // claims, so nothing is renamed and nothing needs restoring.
    expect(map.size).toBe(0);
    expect(namesOf(body.tools).sort().join()).toBe(OPENCODE_FINGERPRINT_TOOLS.slice().sort().join());
  });

  it("keeps a Windows-worded caller shell in place, without a shell note", () => {
    const body = { messages: [{ role: "system", content: "Be brief." }], tools: [callerShellWith("Windows using powershell"), { type: "function", function: { name: "Edit" } }] };
    const map = applyFingerprintTools(body, false);

    expect(map.size).toBe(0);
    expect(namesOf(body.tools)).toEqual(["shell", "Edit", "read"]);
    const note = body.messages[0].content;
    expect(note).toMatch(/^Be brief\.\n\nDo not call the `read` tool;/);
    expect(note).not.toContain("shell_client");
  });

  it("keeps a macOS-worded caller shell in place", () => {
    const body = { tools: [callerShellWith("macOS using zsh")] };
    const map = applyFingerprintTools(body, false);
    expect(map.size).toBe(0);
    expect(namesOf(body.tools)).toEqual(["shell", "read"]);
  });

  it("renames a caller shell whose parameters differ, whatever the wording", () => {
    const alien = callerShellWith("Windows using powershell", { type: "object", properties: { cmd: { type: "string" } }, required: ["cmd"] });
    const body = { tools: [alien] };
    const map = applyFingerprintTools(body, false);

    expect(namesOf(body.tools)).toEqual(["shell_client", "read", "shell"]);
    expect(map.get("shell_client")).toBe("shell");
    expect(body.tools[0].function.description).toMatch(/Commands run on Windows using powershell\./);
  });
});
