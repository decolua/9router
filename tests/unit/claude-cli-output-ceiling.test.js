import { describe, it, expect } from "vitest";
import { outputTokenCeiling } from "open-sse/executors/claudeCliRequestSupport.js";
import { conflictingHostAuth } from "open-sse/config/claudeCli.js";
import { createClaudeCliContext, translateClaudeCliEvent } from "open-sse/executors/claude-cli.js";

/**
 * A caller asking for a short answer, and a host configured for somewhere else.
 *
 * max_tokens used to be dropped on the floor, with a measured reason that only
 * covered one of the two ways to pass it. Through CLAUDE_CODE_EXTRA_BODY a
 * limit of 32 produced 128 output tokens and then an error with no content, so
 * it was written off. `CLAUDE_CODE_MAX_OUTPUT_TOKENS` is a different channel;
 * measured on 2.1.281, same prompt:
 *
 *   unset  476 output tokens, end_turn,      691 chars
 *   1024   882 output tokens, end_turn,     1547 chars
 *   128    512 output tokens, stop_sequence, 155 chars, is_error
 *   64     256 output tokens, stop_sequence, 154 chars, is_error
 *
 * So it bounds the answer, loosely, and flags a bound turn as an error while
 * still returning its content. Ignoring it meant a caller who asked for a short
 * answer got whatever the model wrote and paid for all of it.
 */

describe("outputTokenCeiling", () => {
  it("takes the limit in either spelling", () => {
    expect(outputTokenCeiling({ max_tokens: 512 })).toBe("512");
    expect(outputTokenCeiling({ max_completion_tokens: 256 })).toBe("256");
  });

  it("is nothing when none was asked for, so the CLI keeps its own default", () => {
    expect(outputTokenCeiling({})).toBe("");
    expect(outputTokenCeiling({ max_tokens: null })).toBe("");
  });

  it("refuses a value that is not a whole positive number", () => {
    // It reaches the child's environment, so it may not be arbitrary text.
    for (const bad of [0, -1, 1.5, "lots", "64; rm -rf /", NaN, Infinity]) {
      expect(outputTokenCeiling({ max_tokens: bad }), String(bad)).toBe("");
    }
  });
});

describe("a turn the ceiling cut short", () => {
  const ctxWith = (tokenCeiling) => createClaudeCliContext({
    id: "chatcmpl-x", created: 1, model: "m", tokenCeiling,
  });
  const parsed = (frames) => frames
    .map((f) => { try { return JSON.parse(f.replace(/^data: /, "").trim()); } catch { return null; } })
    .filter(Boolean);

  // Exactly what the CLI sends when CLAUDE_CODE_MAX_OUTPUT_TOKENS binds.
  const BOUND = {
    type: "result",
    subtype: "success",
    is_error: true,
    stop_reason: "stop_sequence",
    num_turns: 1,
    result: "1\n2\n3",
  };

  it("is delivered as an answer, not thrown away as a failure", () => {
    const ctx = ctxWith(true);
    const events = parsed(translateClaudeCliEvent(BOUND, ctx).frames);
    expect(events.some((e) => e.error)).toBe(false);
    expect(events.find((e) => e.choices?.[0]?.delta?.content)?.choices[0].delta.content).toBe("1\n2\n3");
  });

  it("says it stopped because it ran out of room", () => {
    const ctx = ctxWith(true);
    const events = parsed(translateClaudeCliEvent(BOUND, ctx).frames);
    expect(events.at(-1).choices[0].finish_reason).toBe("length");
  });

  it("is still an error when this request asked for no ceiling", () => {
    // Then the same shape means something else, and guessing would hide it.
    const ctx = ctxWith(false);
    const events = parsed(translateClaudeCliEvent(BOUND, ctx).frames);
    expect(events[0].error).toBeTruthy();
  });
});

describe("conflictingHostAuth", () => {
  it("names a host credential that would have sent the child elsewhere", () => {
    expect(conflictingHostAuth({ ANTHROPIC_API_KEY: "sk-x" })).toEqual(["ANTHROPIC_API_KEY"]);
    expect(conflictingHostAuth({ ANTHROPIC_BASE_URL: "http://x" })).toEqual(["ANTHROPIC_BASE_URL"]);
  });

  it("counts a backend switch only when it is switched on", () => {
    expect(conflictingHostAuth({ CLAUDE_CODE_USE_BEDROCK: "1" })).toEqual(["CLAUDE_CODE_USE_BEDROCK"]);
    for (const off of ["0", "false", "no", "off", ""]) {
      expect(conflictingHostAuth({ CLAUDE_CODE_USE_BEDROCK: off }), off).toEqual([]);
    }
  });

  it("says nothing about a host that has none of them", () => {
    expect(conflictingHostAuth({ PATH: "/usr/bin" })).toEqual([]);
  });
});
