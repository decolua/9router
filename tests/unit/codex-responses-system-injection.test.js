import { describe, expect, it } from "vitest";

import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { injectSystemPrompt } from "../../open-sse/rtk/systemInject.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const USER_MESSAGE = {
  type: "message",
  role: "user",
  content: [{ type: "input_text", text: "Fix the failing test." }],
};

describe("Responses system-prompt injection", () => {
  it("adds a typed message item when a Responses request has no instructions", () => {
    const body = { input: [structuredClone(USER_MESSAGE)] };

    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, "Use concise code changes.");

    expect(body.input).toEqual([
      {
        type: "message",
        role: "system",
        content: [{ type: "input_text", text: "Use concise code changes." }],
      },
      USER_MESSAGE,
    ]);
  });

  it("keeps Responses developer content typed when appending another instruction", () => {
    const body = {
      input: [
        { type: "message", role: "developer", content: [{ type: "input_text", text: "Keep tests focused." }] },
        structuredClone(USER_MESSAGE),
      ],
    };

    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, "Avoid unrelated refactors.");

    expect(body.input[0]).toEqual({
      type: "message",
      role: "developer",
      content: [
        { type: "input_text", text: "Keep tests focused." },
        { type: "input_text", text: "Avoid unrelated refactors." },
      ],
    });
  });

  it("allows Caveman and Ponytail to append to the same Responses message", () => {
    const body = { input: [structuredClone(USER_MESSAGE)] };

    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, "Respond tersely.");
    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, "Prefer the smallest safe diff.");

    expect(body.input[0]).toEqual({
      type: "message",
      role: "system",
      content: [
        { type: "input_text", text: "Respond tersely." },
        { type: "input_text", text: "Prefer the smallest safe diff." },
      ],
    });
  });

  it("retains the Chat Completions string shape", () => {
    const body = { messages: [{ role: "user", content: "Hello" }] };

    injectSystemPrompt(body, FORMATS.OPENAI, "Use concise code changes.");

    expect(body.messages[0]).toEqual({ role: "system", content: "Use concise code changes." });
  });
});

describe("CodexExecutor Responses normalization", () => {
  it("preserves the typed injection through the final Codex transform", () => {
    const body = {
      model: "gpt-5.6-terra",
      input: [structuredClone(USER_MESSAGE)],
    };

    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, "Use concise code changes.");
    new CodexExecutor().transformRequest("gpt-5.6-terra", body, true, {});

    expect(body.input[0]).toEqual({
      type: "message",
      role: "developer",
      content: [{ type: "input_text", text: "Use concise code changes." }],
    });
  });

  it("repairs a legacy role/content item before the Codex request is dispatched", () => {
    const body = {
      model: "gpt-5.6-terra",
      input: [
        { role: "system", content: "Use concise code changes." },
        structuredClone(USER_MESSAGE),
      ],
    };

    new CodexExecutor().transformRequest("gpt-5.6-terra", body, true, {});

    expect(body.input[0]).toEqual({
      type: "message",
      role: "developer",
      content: [{ type: "input_text", text: "Use concise code changes." }],
    });
    expect(body.input[1]).toEqual(USER_MESSAGE);
  });

  it("does not rewrite typed tool-call history", () => {
    const toolCall = { type: "function_call", call_id: "call_1", name: "read_file", arguments: "{}" };
    const body = {
      model: "gpt-5.6-terra",
      input: [structuredClone(toolCall), structuredClone(USER_MESSAGE)],
    };

    new CodexExecutor().transformRequest("gpt-5.6-terra", body, true, {});

    expect(body.input[0]).toEqual(toolCall);
  });
});
