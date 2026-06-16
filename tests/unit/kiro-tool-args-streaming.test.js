import { describe, it, expect } from "vitest";
import { flushBufferedToolArgs } from "../../open-sse/executors/kiro.js";

function makeMockController() {
  const enqueued = [];
  return {
    enqueued,
    enqueue(bytes) {
      enqueued.push(new TextDecoder().decode(bytes));
    }
  };
}

function parseSSEData(sseLines) {
  return sseLines.map(line => {
    const m = line.match(/^data: (.+)\n\n$/);
    return m ? JSON.parse(m[1]) : null;
  }).filter(Boolean);
}

function reconstructArguments(chunks) {
  const perIndex = new Map();
  for (const chunk of chunks) {
    const tc = chunk.choices?.[0]?.delta?.tool_calls?.[0];
    if (!tc) continue;
    const idx = tc.index;
    const args = tc.function?.arguments || "";
    perIndex.set(idx, (perIndex.get(idx) || "") + args);
  }
  return perIndex;
}

describe("kiro tool args streaming — partial-object bug regression", () => {
  it("flushes a single buffered tool call with valid concatenable JSON", () => {
    const state = {
      toolArgsEmitted: new Map(),
      toolArgsBuffered: new Map([
        ["tool_abc", { toolIndex: 0, canonical: '{"command":"cat /home/wxsys/Project/naskin/.impeccable.md"}' }]
      ])
    };
    const controller = makeMockController();
    flushBufferedToolArgs(state, controller, { responseId: "resp_test", created: 1, model: "kiro" });

    const chunks = parseSSEData(controller.enqueued);
    expect(chunks).toHaveLength(1);

    const args = reconstructArguments(chunks);
    const final = args.get(0);
    expect(() => JSON.parse(final)).not.toThrow();
    expect(JSON.parse(final)).toEqual({ command: "cat /home/wxsys/Project/naskin/.impeccable.md" });

    expect(state.toolArgsBuffered.size).toBe(0);
    expect(state.toolArgsEmitted.get("tool_abc")).toBe(final);
  });

  it("simulates the reported bug: 4 partial-object events produce 1 valid flush", () => {
    const state = {
      toolArgsEmitted: new Map(),
      toolArgsBuffered: new Map()
    };

    const partialPayloads = [
      { command: "cat /home" },
      { command: "cat /home/wxsys" },
      { command: "cat /home/wxsys/Project" },
      { command: "cat /home/wxsys/Project/naskin/.impeccable.md" }
    ];
    for (const input of partialPayloads) {
      state.toolArgsBuffered.set("tool_abc", { toolIndex: 0, canonical: JSON.stringify(input) });
    }

    const controller = makeMockController();
    flushBufferedToolArgs(state, controller, { responseId: "resp_test", created: 1, model: "kiro" });

    const chunks = parseSSEData(controller.enqueued);
    expect(chunks).toHaveLength(1);

    const args = reconstructArguments(chunks);
    const final = args.get(0);
    expect(() => JSON.parse(final)).not.toThrow();
    expect(JSON.parse(final).command).toBe("cat /home/wxsys/Project/naskin/.impeccable.md");
  });

  it("flushes multiple concurrent tool calls preserving toolIndex", () => {
    const state = {
      toolArgsEmitted: new Map(),
      toolArgsBuffered: new Map([
        ["T1", { toolIndex: 0, canonical: '{"filePath":"/a/b/c.txt"}' }],
        ["T2", { toolIndex: 1, canonical: '{"command":"ls"}' }]
      ])
    };
    const controller = makeMockController();
    flushBufferedToolArgs(state, controller, { responseId: "resp_test", created: 1, model: "kiro" });

    const chunks = parseSSEData(controller.enqueued);
    expect(chunks).toHaveLength(2);

    const args = reconstructArguments(chunks);
    expect(JSON.parse(args.get(0))).toEqual({ filePath: "/a/b/c.txt" });
    expect(JSON.parse(args.get(1))).toEqual({ command: "ls" });
  });

  it("does not re-emit when canonical equals already-emitted (idempotent)", () => {
    const state = {
      toolArgsEmitted: new Map([["tool_abc", '{"command":"ls"}']]),
      toolArgsBuffered: new Map([
        ["tool_abc", { toolIndex: 0, canonical: '{"command":"ls"}' }]
      ])
    };
    const controller = makeMockController();
    flushBufferedToolArgs(state, controller, { responseId: "resp_test", created: 1, model: "kiro" });

    expect(controller.enqueued).toHaveLength(0);
    expect(state.toolArgsBuffered.size).toBe(0);
  });

  it("no-op when buffer is empty", () => {
    const state = {
      toolArgsEmitted: new Map(),
      toolArgsBuffered: new Map()
    };
    const controller = makeMockController();
    flushBufferedToolArgs(state, controller, { responseId: "resp_test", created: 1, model: "kiro" });

    expect(controller.enqueued).toHaveLength(0);
  });
});

describe("kiro tool args streaming — concatenation contract (regression)", () => {
  it("OLD BUG: re-stringifying each partial object produces unparseable concat", () => {
    const partials = [
      { command: "cat /home" },
      { command: "cat /home/wxsys" },
      { command: "cat /home/wxsys/Project/naskin/.impeccable.md" }
    ];
    const buggyConcat = partials.map(p => JSON.stringify(p)).join("");

    expect(() => JSON.parse(buggyConcat)).toThrow();
  });

  it("FIX: emitting only the final canonical produces parseable JSON", () => {
    const partials = [
      { command: "cat /home" },
      { command: "cat /home/wxsys" },
      { command: "cat /home/wxsys/Project/naskin/.impeccable.md" }
    ];
    const fixedConcat = JSON.stringify(partials[partials.length - 1]);

    expect(() => JSON.parse(fixedConcat)).not.toThrow();
    expect(JSON.parse(fixedConcat).command).toBe("cat /home/wxsys/Project/naskin/.impeccable.md");
  });
});
