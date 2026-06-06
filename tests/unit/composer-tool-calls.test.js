import { describe, it, expect } from "vitest";
import {
  parseComposerToolCalls,
  hasComposerToolCalls,
  createStreamingState,
  feedStreamingChunk,
} from "../../open-sse/utils/composerToolCalls.js";

describe("Composer DeepSeek tool-call parser", () => {
  it("returns input unchanged when no tool-call block is present", () => {
    const text = "Hello there, no tools here.";
    const { content, toolCalls } = parseComposerToolCalls(text);
    expect(content).toBe(text);
    expect(toolCalls).toEqual([]);
    expect(hasComposerToolCalls(text)).toBe(false);
  });

  it("parses a single tool call with full-width markers", () => {
    const text =
      "<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>\nsearch_files\n" +
      "<｜tool▁sep｜>pattern\n*cron*.py\n" +
      "<｜tool▁sep｜>path\n/home/noestelar/.hermes\n" +
      "<｜tool▁call▁end｜><｜tool▁calls▁end｜>";
    const { content, toolCalls } = parseComposerToolCalls(text);
    expect(content).toBe("");
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].type).toBe("function");
    expect(toolCalls[0].function.name).toBe("search_files");
    const args = JSON.parse(toolCalls[0].function.arguments);
    expect(args).toEqual({ pattern: "*cron*.py", path: "/home/noestelar/.hermes" });
  });

  it("parses two sequential tool calls and preserves order", () => {
    const text =
      "<｜tool▁calls▁begin｜>" +
      "<｜tool▁call▁begin｜>\nread_file\n<｜tool▁sep｜>path\n/etc/hostname\n<｜tool▁call▁end｜>" +
      "<｜tool▁call▁begin｜>\nsearch_files\n<｜tool▁sep｜>pattern\ncron\n<｜tool▁sep｜>path\n/tmp\n<｜tool▁call▁end｜>" +
      "<｜tool▁calls▁end｜>";
    const { toolCalls } = parseComposerToolCalls(text);
    expect(toolCalls.map(t => t.function.name)).toEqual(["read_file", "search_files"]);
    expect(JSON.parse(toolCalls[1].function.arguments)).toEqual({ pattern: "cron", path: "/tmp" });
  });

  it("extracts preamble and trailing text as residual content", () => {
    const text =
      "Writing `hi` to file.\n\n" +
      "<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>\nwrite_file\n" +
      "<｜tool▁sep｜>path\n/tmp/x.txt\n" +
      "<｜tool▁sep｜>content\nhi\n" +
      "<｜tool▁call▁end｜><｜tool▁calls▁end｜>\nDone!";
    const { content, toolCalls } = parseComposerToolCalls(text);
    expect(content).toBe("Writing `hi` to file.\n\n\nDone!".trim());
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].function.name).toBe("write_file");
  });

  it("preserves multiline argument values verbatim", () => {
    const text =
      "<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>\nwrite_file\n" +
      "<｜tool▁sep｜>path\n/tmp/x.py\n" +
      "<｜tool▁sep｜>content\nimport os\nprint('hi')\n\n# comment\n" +
      "<｜tool▁call▁end｜><｜tool▁calls▁end｜>";
    const { toolCalls } = parseComposerToolCalls(text);
    const args = JSON.parse(toolCalls[0].function.arguments);
    expect(args.path).toBe("/tmp/x.py");
    expect(args.content).toBe("import os\nprint('hi')\n\n# comment");
  });

  it("coerces JSON-shaped arg values to native JSON", () => {
    const text =
      "<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>\nrun_query\n" +
      "<｜tool▁sep｜>filters\n{\"name\":\"Noé\",\"age\":30,\"tags\":[\"a\",\"b\"]}\n" +
      "<｜tool▁sep｜>limit\n10\n" +
      "<｜tool▁sep｜>active\ntrue\n" +
      "<｜tool▁call▁end｜><｜tool▁calls▁end｜>";
    const { toolCalls } = parseComposerToolCalls(text);
    const args = JSON.parse(toolCalls[0].function.arguments);
    expect(args.filters).toEqual({ name: "Noé", age: 30, tags: ["a", "b"] });
    expect(args.limit).toBe(10);
    expect(args.active).toBe(true);
  });

  it("accepts ASCII fallback markers", () => {
    const text =
      "<|tool_calls_begin|><|tool_call_begin|>\nfoo\n" +
      "<|tool_sep|>a\n1\n<|tool_call_end|><|tool_calls_end|>";
    const { toolCalls } = parseComposerToolCalls(text);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].function.name).toBe("foo");
    expect(JSON.parse(toolCalls[0].function.arguments)).toEqual({ a: 1 });
  });
});

describe("Composer streaming tool-call parser", () => {
  it("emits visible preamble before the tool-call block opens", () => {
    const state = createStreamingState();
    const out = feedStreamingChunk(state, "Writing now.\n\n");
    expect(out.safeDelta).toBe("Writing now.\n\n");
    expect(out.ready).toBe(false);
    expect(out.holdback).toBe(false);
  });

  it("holds back content once the opening marker is seen", () => {
    const state = createStreamingState();
    const a = feedStreamingChunk(state, "Writing `hi` to file.");
    expect(a.safeDelta).toBe("Writing `hi` to file.");
    expect(a.holdback).toBe(false);
    const b = feedStreamingChunk(
      state,
      "Writing `hi` to file.\n<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>\nwrite_file"
    );
    expect(b.safeDelta).toBe("\n");
    expect(b.ready).toBe(false);
    expect(b.holdback).toBe(true);
  });

  it("flushes tool calls once the closing marker arrives", () => {
    const state = createStreamingState();
    const acc =
      "ok\n<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>\nwrite_file\n" +
      "<｜tool▁sep｜>path\n/tmp/x\n<｜tool▁sep｜>content\nhi\n" +
      "<｜tool▁call▁end｜><｜tool▁calls▁end｜>";
    // Simulate it arriving in two halves.
    feedStreamingChunk(state, acc.slice(0, 30));
    const out = feedStreamingChunk(state, acc);
    expect(out.ready).toBe(true);
    expect(out.toolCalls).toHaveLength(1);
    expect(out.toolCalls[0].function.name).toBe("write_file");
    expect(JSON.parse(out.toolCalls[0].function.arguments)).toEqual({
      path: "/tmp/x",
      content: "hi",
    });
  });

  it("does not leak a partial opening marker split across frames", () => {
    const state = createStreamingState();
    const a = feedStreamingChunk(state, "Working on it.<｜tool▁call");
    expect(a.safeDelta).toBe("Working on it.");
    expect(a.holdback).toBe(true);
    const b = feedStreamingChunk(state, "Working on it.<｜tool▁calls▁begin｜>");
    expect(b.safeDelta).toBe("");
    expect(b.holdback).toBe(true);
  });

  it("emits no tool calls when the block closes empty (defensive)", () => {
    const state = createStreamingState();
    const out = feedStreamingChunk(
      state,
      "<｜tool▁calls▁begin｜><｜tool▁calls▁end｜>"
    );
    expect(out.ready).toBe(true);
    expect(out.toolCalls).toEqual([]);
  });
});
