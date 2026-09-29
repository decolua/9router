import { describe, expect, it } from "vitest";
import { createOpenCodeToolResponseGuard } from "open-sse/utils/opencodeToolResponseGuard.js";
import { applyFingerprintTools, takeFingerprintMetadata } from "open-sse/utils/opencodeFingerprint.js";

const chatTools = (names) => names.map((name) => ({ type: "function", function: { name } }));

function fingerprintMetadata(names = []) {
  const body = { tools: chatTools(names) };
  applyFingerprintTools(body, false);
  return takeFingerprintMetadata(body);
}

const chat = (choiceIndex, callIndex, name) => ({
  choices: [{ index: choiceIndex, delta: { tool_calls: [{ index: callIndex, function: { name } }] } }],
});

const call = (payload, event = JSON.stringify(payload), serializedSize) => ({ payload, event, serializedSize });

function expectGuardError(action, code) {
  try {
    action();
    throw new Error("expected guard error");
  } catch (error) {
    expect(error.code).toBe(code);
  }
}

describe("OpenCode tool response guard", () => {
  it("holds a fragmented legitimate grep_project name until finish_reason resolves it", () => {
    const guard = createOpenCodeToolResponseGuard(fingerprintMetadata());
    expect(guard.consume(call(chat(0, 0, "grep"), "first")).releasedEvents).toEqual([]);
    expect(guard.consume(call(chat(0, 0, "_project"), "second")).releasedEvents).toEqual([]);
    const terminal = { choices: [{ index: 0, finish_reason: "tool_calls" }] };
    expect(guard.consume(call(terminal, "terminal")).releasedEvents).toEqual(["first", "second", "terminal"]);
    expect(guard.finish().releasedEvents).toEqual([]);
  });

  it("rejects an injected-only Chat call only when finish_reason makes its name definitive", () => {
    const guard = createOpenCodeToolResponseGuard(fingerprintMetadata());
    expect(guard.consume(call(chat(0, 0, "grep"), "blocked")).releasedEvents).toEqual([]);
    expectGuardError(() => guard.consume(call({ choices: [{ index: 0, finish_reason: "tool_calls" }] }, "finish")), "upstream_undeclared_tool");
  });

  it("tracks interleaved choices and falls back to array positions when final JSON calls omit indices", () => {
    const guard = createOpenCodeToolResponseGuard(fingerprintMetadata());
    expect(guard.consume(call(chat(0, 0, "grep"), "a")).releasedEvents).toEqual([]);
    expect(guard.consume(call(chat(1, 0, "grep_project"), "b")).releasedEvents).toEqual([]);
    const finalJson = {
      choices: [
        { message: { tool_calls: [{ function: { name: "grep_project" } }] }, finish_reason: "tool_calls" },
        { message: { tool_calls: [{ function: { name: "grep_project" } }] }, finish_reason: "tool_calls" },
      ],
    };
    expect(guard.consume(call(finalJson, "final")).releasedEvents).toEqual(["a", "b", "final"]);
    expect(guard.finish().releasedEvents).toEqual([]);
  });

  it("allows argument-only continuations for a known identity until its terminal choice", () => {
    const guard = createOpenCodeToolResponseGuard(fingerprintMetadata());
    expect(guard.consume(call(chat(0, 0, "grep_project"), "name")).releasedEvents).toEqual([]);
    const argumentsOnly = {
      choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "{}" } }] } }],
    };
    expect(guard.consume(call(argumentsOnly, "arguments")).releasedEvents).toEqual([]);
    expect(guard.consume(call({ choices: [{ index: 0, finish_reason: "tool_calls" }] }, "finish")).releasedEvents)
      .toEqual(["name", "arguments", "finish"]);
  });

  it("rejects complete Responses and Claude injected-only names immediately", () => {
    const responses = createOpenCodeToolResponseGuard(fingerprintMetadata());
    expectGuardError(
      () => responses.consume(call({ output_index: 0, item: { type: "function_call", name: "grep" } })),
      "upstream_undeclared_tool",
    );
    const nestedResponses = createOpenCodeToolResponseGuard(fingerprintMetadata());
    expectGuardError(() => nestedResponses.consume(call({ response: { output: [{ type: "function_call", name: "grep" }] } })), "upstream_undeclared_tool");
    const claude = createOpenCodeToolResponseGuard(fingerprintMetadata());
    expectGuardError(
      () => claude.consume(call({ index: 0, type: "content_block_start", content_block: { type: "tool_use", name: "grep" } })),
      "upstream_undeclared_tool",
    );
  });

  it("permits an actual caller Grep canonicalized by applyFingerprintTools", () => {
    const metadata = fingerprintMetadata(["Grep"]);
    const guard = createOpenCodeToolResponseGuard(metadata);
    expect(metadata.renameMap.get("grep")).toBe("Grep");
    expect(metadata.injectedNames.has("grep")).toBe(false);
    expect(guard.consume(call(chat(0, 0, "grep"), "grep")).releasedEvents).toEqual([]);
    expect(guard.consume(call({ choices: [{ index: 0, finish_reason: "tool_calls" }] }, "finish")).releasedEvents)
      .toEqual(["grep", "finish"]);
  });

  it("rejects malformed identities and unresolved suffixes at finish", () => {
    const malformed = createOpenCodeToolResponseGuard(fingerprintMetadata());
    expectGuardError(() => malformed.consume(call({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: {} }] } }] })), "upstream_tool_malformed");
    const unresolved = createOpenCodeToolResponseGuard(fingerprintMetadata());
    unresolved.consume(call(chat(0, 0, "gr"), "tail"));
    expectGuardError(() => unresolved.finish(), "upstream_tool_unresolved");
  });

  it("enforces final Chat name bounds and exact UTF-8 byte limits", () => {
    const finalChat = createOpenCodeToolResponseGuard(fingerprintMetadata());
    expect(finalChat.consume(call({
      choices: [{ message: { tool_calls: [{ function: { name: "x".repeat(256) } }] }, finish_reason: "tool_calls" }],
    }, "final"))).toBeDefined();
    expectGuardError(() => finalChat.consume(call({
      choices: [{ message: { tool_calls: [{ function: { name: "x".repeat(257) } }] }, finish_reason: "tool_calls" }],
    }, "too-long")), "upstream_tool_name_limit");

    const multibyte = createOpenCodeToolResponseGuard(fingerprintMetadata());
    expect(multibyte.consume(call(chat(0, 0, "é".repeat(128)), "name"))).toBeDefined();
    expectGuardError(() => multibyte.consume(call(chat(0, 0, "é"), "name+1")), "upstream_tool_name_limit");
  });

  it("enforces 64 distinct Responses and Claude calls without collapsing index identities", () => {
    const responseGuard = createOpenCodeToolResponseGuard(fingerprintMetadata());
    for (let outputIndex = 0; outputIndex < 64; outputIndex++) {
      expect(responseGuard.consume(call({
        output_index: outputIndex,
        item: { type: "function_call", name: "tool" },
      }, `response-${outputIndex}`)).releasedEvents).toEqual([`response-${outputIndex}`]);
    }
    expectGuardError(
      () => responseGuard.consume(call({ output_index: 64, item: { type: "function_call", name: "tool" } }, "response-65")),
      "upstream_tool_call_limit",
    );

    const claudeGuard = createOpenCodeToolResponseGuard(fingerprintMetadata());
    for (let index = 0; index < 64; index++) {
      expect(claudeGuard.consume(call({
        index,
        type: "content_block_start",
        content_block: { type: "tool_use", name: "tool" },
      }, `claude-${index}`)).releasedEvents).toEqual([`claude-${index}`]);
    }
    expectGuardError(
      () => claudeGuard.consume(call({
        index: 64,
        type: "content_block_start",
        content_block: { type: "tool_use", name: "tool" },
      }, "claude-65")),
      "upstream_tool_call_limit",
    );
  });

  it("counts array members by position despite extraneous envelope indices", () => {
    const responseGuard = createOpenCodeToolResponseGuard(fingerprintMetadata());
    const responseOutput = Array.from({ length: 64 }, () => ({ type: "function_call", name: "tool" }));
    expect(responseGuard.consume(call({ output_index: 0, output: responseOutput }, "responses-array")).releasedEvents)
      .toEqual(["responses-array"]);
    expectGuardError(
      () => responseGuard.consume(call({ output_index: 0, output: [...responseOutput, { type: "function_call", name: "tool" }] }, "responses-array-65")),
      "upstream_tool_call_limit",
    );

    const claudeGuard = createOpenCodeToolResponseGuard(fingerprintMetadata());
    const claudeContent = Array.from({ length: 64 }, () => ({ type: "tool_use", name: "tool" }));
    expect(claudeGuard.consume(call({ index: 0, content: claudeContent }, "claude-array")).releasedEvents)
      .toEqual(["claude-array"]);
    expectGuardError(
      () => claudeGuard.consume(call({ index: 0, content: [...claudeContent, { type: "tool_use", name: "tool" }] }, "claude-array-65")),
      "upstream_tool_call_limit",
    );
  });

  it("deduplicates stable IDs, keeps ID zero distinct from index zero, and rejects missing standalone identity", () => {
    const guard = createOpenCodeToolResponseGuard(fingerprintMetadata());
    const idZero = { type: "function_call", name: "tool", call_id: "0" };
    expect(guard.consume(call({ output_index: 0, item: idZero }, "id-zero")).releasedEvents).toEqual(["id-zero"]);
    expect(guard.consume(call({ output_index: 0, item: idZero }, "id-zero-repeat")).releasedEvents).toEqual(["id-zero-repeat"]);
    expect(guard.consume(call({ output_index: 0, item: { type: "function_call", name: "tool" } }, "index-zero")).releasedEvents)
      .toEqual(["index-zero"]);
    expectGuardError(
      () => guard.consume(call({ item: { type: "function_call", name: "tool" } }, "missing-identity")),
      "upstream_tool_malformed",
    );
  });

  it("includes the resolving terminal in the one MiB held suffix bound", () => {
    const buffered = createOpenCodeToolResponseGuard(fingerprintMetadata());
    buffered.consume(call(chat(0, 0, "grep_project"), "first", (1024 * 1024) - 1));
    expectGuardError(
      () => buffered.consume(call({ choices: [{ index: 0, finish_reason: "tool_calls" }] }, "finish", 2)),
      "upstream_tool_buffer_overflow",
    );
  });

  it("releases ordinary text events immediately and holds an injected fragment until finish", () => {
    const guard = createOpenCodeToolResponseGuard(fingerprintMetadata());
    expect(guard.consume(call({ choices: [{ index: 0, delta: { content: "text" } }] }, "text")).releasedEvents).toEqual(["text"]);
    expect(guard.consume(call(chat(0, 0, "grep"), "blocked")).releasedEvents).toEqual([]);
    expectGuardError(() => guard.finish(), "upstream_tool_unresolved");
  });
});
