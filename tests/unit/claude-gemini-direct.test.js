import { describe, it, expect } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { claudeToGeminiRequest } from "../../open-sse/translator/request/claude-to-gemini.js";
import { geminiToClaudeResponse } from "../../open-sse/translator/response/gemini-to-claude.js";

const roles = (r) => r.contents.map((c) => c.role);

describe("claude→gemini direct request route", () => {
  it("is selected instead of the openai pivot", () => {
    const out = translateRequest(FORMATS.CLAUDE, FORMATS.GEMINI, "gemini-3-pro", {
      messages: [{ role: "user", content: "hello" }],
    }, false);

    // The pivot would have produced OpenAI-shaped `messages` somewhere along the
    // way; the direct route yields Gemini `contents` and nothing else.
    expect(Array.isArray(out.contents)).toBe(true);
    expect(out.messages).toBeUndefined();
  });

  it("maps system, text, images and generation config", () => {
    const out = claudeToGeminiRequest("gemini-3-pro", {
      system: "be terse",
      max_tokens: 1024,
      temperature: 0.2,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "what is this?" },
          { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
        ],
      }],
    }, true);

    expect(out.systemInstruction.parts[0].text).toBe("be terse");
    expect(out.generationConfig.maxOutputTokens).toBe(1024);
    expect(out.generationConfig.temperature).toBe(0.2);
    expect(out.contents[0].parts[0].text).toBe("what is this?");
    expect(out.contents[0].parts[1].inlineData).toEqual({ mimeType: "image/png", data: "AAAA" });
  });

  it("carries tool_use and tool_result across with the name attached", () => {
    const out = claudeToGeminiRequest("gemini-3-pro", {
      messages: [
        { role: "user", content: "list the files" },
        { role: "assistant", content: [{ type: "tool_use", id: "tu_1", name: "Bash", input: { cmd: "ls" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", content: "a.js" }] },
      ],
    }, false);

    expect(roles(out)).toEqual(["user", "model", "user"]);
    expect(out.contents[1].parts[0].functionCall).toMatchObject({ name: "Bash", args: { cmd: "ls" } });
    // A tool_result knows only the id; the name has to be recovered from the call.
    expect(out.contents[2].parts[0].functionResponse).toMatchObject({ name: "Bash" });
  });

  it("keeps is_error distinguishable on a failed tool result", () => {
    const out = claudeToGeminiRequest("gemini-3-pro", {
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "tu_1", name: "Bash", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", content: "boom", is_error: true }] },
      ],
    }, false);

    expect(out.contents.at(-1).parts[0].functionResponse.response).toHaveProperty("error");
  });

  it("preserves the speaker boundary an emptied assistant turn would break", () => {
    const out = claudeToGeminiRequest("gemini-3-pro", {
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "" },
        { role: "user", content: "second" },
      ],
    }, false);

    expect(roles(out)).toEqual(["user", "model", "user"]);
  });

  it("does not leave a trailing model turn to be continued", () => {
    const out = claudeToGeminiRequest("gemini-3-pro", {
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "" },
      ],
    }, false);

    expect(roles(out).at(-1)).toBe("user");
  });

  it("converts claude tools to functionDeclarations", () => {
    const out = claudeToGeminiRequest("gemini-3-pro", {
      messages: [{ role: "user", content: "go" }],
      tools: [{ name: "Read", description: "read a file", input_schema: { type: "object", properties: { path: { type: "string" } } } }],
    }, false);

    expect(out.tools[0].functionDeclarations[0]).toMatchObject({ name: "Read", description: "read a file" });
    expect(out.tools[0].functionDeclarations[0].parameters).toBeTruthy();
  });
});

describe("gemini→claude direct response route", () => {
  const run = (chunks) => {
    const state = {};
    const events = [];
    for (const c of chunks) {
      const out = geminiToClaudeResponse(c, state);
      if (out) events.push(...out);
    }
    return events;
  };

  it("opens with message_start and emits text deltas", () => {
    const events = run([
      { candidates: [{ content: { parts: [{ text: "Hello" }] } }] },
      { candidates: [{ content: { parts: [{ text: " world" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 } },
    ]);

    const types = events.map((e) => e.type);
    expect(types[0]).toBe("message_start");
    expect(types).toContain("content_block_start");
    expect(types.at(-1)).toBe("message_stop");
    const text = events.filter((e) => e.delta?.type === "text_delta").map((e) => e.delta.text).join("");
    expect(text).toBe("Hello world");
  });

  it("emits a tool_use block with complete arguments in one delta", () => {
    const events = run([
      { candidates: [{ content: { parts: [{ functionCall: { id: "c1", name: "Bash", args: { cmd: "ls" } } }] }, finishReason: "STOP" }] },
    ]);

    const start = events.find((e) => e.content_block?.type === "tool_use");
    expect(start.content_block).toMatchObject({ name: "Bash", id: "c1" });
    const delta = events.find((e) => e.delta?.type === "input_json_delta");
    expect(JSON.parse(delta.delta.partial_json)).toEqual({ cmd: "ls" });
    const stop = events.find((e) => e.type === "message_delta");
    expect(stop.delta.stop_reason).toBe("tool_use");
  });

  it("maps thought parts to thinking blocks, not text", () => {
    const events = run([
      { candidates: [{ content: { parts: [{ thought: true, text: "considering" }, { text: "Answer." }] }, finishReason: "STOP" }] },
    ]);

    expect(events.some((e) => e.content_block?.type === "thinking")).toBe(true);
    expect(events.some((e) => e.delta?.type === "thinking_delta")).toBe(true);
    const text = events.filter((e) => e.delta?.type === "text_delta").map((e) => e.delta.text).join("");
    expect(text).toBe("Answer.");
  });

  it("unwraps the gemini-cli/antigravity envelope", () => {
    const events = run([{ response: { candidates: [{ content: { parts: [{ text: "hi" }] }, finishReason: "STOP" }] } }]);
    expect(events.some((e) => e.delta?.type === "text_delta")).toBe(true);
  });

  it("reports max_tokens rather than end_turn when truncated", () => {
    const events = run([{ candidates: [{ content: { parts: [{ text: "cut" }] }, finishReason: "MAX_TOKENS" }] }]);
    expect(events.find((e) => e.type === "message_delta").delta.stop_reason).toBe("max_tokens");
  });

  it("flushes a parked echo tail instead of dropping it", () => {
    // filterEchoText holds back a possible split-tag tail; without a flush at
    // end of stream a reply ending in "<" loses those characters.
    const events = run([
      { candidates: [{ content: { parts: [{ text: "if (a " }] } }] },
      { candidates: [{ content: { parts: [{ text: "<" }] } }] },
      { candidates: [{ content: { parts: [{ text: "" }] }, finishReason: "STOP" }] },
    ]);
    const text = events.filter((e) => e.delta?.type === "text_delta").map((e) => e.delta.text).join("");
    expect(text).toBe("if (a <");
  });

  it("backfills thoughtSignature on history functionCall parts", () => {
    // Gemini 3+ rejects a functionCall part without one, and clients do not
    // persist it. The pivot route this replaces attached one.
    const out = claudeToGeminiRequest("gemini-3-pro", {
      messages: [{ role: "assistant", content: [{ type: "tool_use", id: "tu_1", name: "Bash", input: {} }] }],
    });
    expect(out.contents[0].parts[0].thoughtSignature).toBeTruthy();
  });

  it("does not mutate the caller's tool schema", () => {
    // The combo cascade reuses the same body for the next model on failover.
    const schema = { type: "object", properties: { path: { type: "string" } }, additionalProperties: false };
    const body = { messages: [{ role: "user", content: "go" }], tools: [{ name: "Read", input_schema: schema }] };
    const before = JSON.stringify(schema);
    claudeToGeminiRequest("gemini-3-pro", body);
    expect(JSON.stringify(schema)).toBe(before);
  });

  it("ignores frames carrying nothing", () => {
    const state = {};
    expect(geminiToClaudeResponse("[DONE]", state)).toBeNull();
    expect(geminiToClaudeResponse("not json", state)).toBeNull();
  });
});

describe("gemini→claude: a started stream never ends empty", () => {
  // Gemini omits content.parts entirely when it blocks a candidate, so a
  // SAFETY finish used to emit message_start → message_delta → message_stop
  // with no content block at all. Claude Code renders nothing for that,
  // persists no assistant entry, and injects "[Your previous response had no
  // visible output. Please continue...]" — which is blocked again, forever.
  // 238 instances of that marker were found across ~/.claude/projects.
  const renderable = (events) =>
    events.filter((e) => e.type === "content_block_start")
      .filter((e) => e.content_block.type === "text" || e.content_block.type === "tool_use");

  const drive = (chunks) => {
    const state = {};
    const out = [];
    for (const c of chunks) {
      const r = geminiToClaudeResponse(c, state);
      if (r) out.push(...r);
    }
    return out;
  };

  for (const reason of ["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "MALFORMED_FUNCTION_CALL"]) {
    it(`explains a ${reason} candidate that carries no parts`, () => {
      const out = drive([{
        candidates: [{ finishReason: reason }],
        modelVersion: "gemini-pro-default",
      }]);

      expect(renderable(out).length).toBeGreaterThan(0);
      expect(out.at(-1).type).toBe("message_stop");
      const text = out.filter((e) => e.delta?.type === "text_delta").map((e) => e.delta.text).join("");
      expect(text).toContain(reason);
    });
  }

  it("names the blocked safety categories when Gemini reports them", () => {
    const out = drive([{
      candidates: [{
        finishReason: "SAFETY",
        safetyRatings: [{ category: "HARM_CATEGORY_HARASSMENT", blocked: true }],
      }],
      promptFeedback: { blockReason: "SAFETY" },
      modelVersion: "gemini-pro-default",
    }]);

    const text = out.filter((e) => e.delta?.type === "text_delta").map((e) => e.delta.text).join("");
    expect(text).toContain("HARM_CATEGORY_HARASSMENT");
    expect(text).toContain("blockReason=SAFETY");
  });

  // Each of these used to return null on its own, so a stream ending any of
  // these ways emitted no message_stop — a dangling message, which the client
  // also reports as "no visible output".
  for (const [label, terminator] of [
    ["[DONE]", "[DONE]"],
    ["data: [DONE]", "data: [DONE]"],
    ["an unparseable body", "<html>502 Bad Gateway</html>"],
    ["a non-object chunk", null],
  ]) {
    it(`closes a started stream terminated by ${label}`, () => {
      const out = drive([
        { candidates: [{ content: { parts: [] } }], modelVersion: "gemini-pro-default" },
        terminator,
      ]);

      expect(renderable(out).length).toBeGreaterThan(0);
      expect(out.at(-1).type).toBe("message_stop");
    });
  }

  it("surfaces the unparseable body rather than swallowing it", () => {
    const out = drive([
      { candidates: [{ content: { parts: [] } }], modelVersion: "gemini-pro-default" },
      "RESOURCE_EXHAUSTED: Quota exceeded for quota metric generate_requests",
    ]);

    const text = out.filter((e) => e.delta?.type === "text_delta").map((e) => e.delta.text).join("");
    expect(text).toContain("RESOURCE_EXHAUSTED");
  });

  it("leaves a normal reply and a tool call untouched", () => {
    const reply = drive([{
      candidates: [{ content: { parts: [{ text: "hello" }] }, finishReason: "STOP" }],
      modelVersion: "gemini-pro-default",
    }]);
    const replyText = reply.filter((e) => e.delta?.type === "text_delta").map((e) => e.delta.text).join("");
    expect(replyText).toBe("hello");
    expect(replyText).not.toContain("[9router]");

    const call = drive([{
      candidates: [{ content: { parts: [{ functionCall: { name: "Bash", args: { command: "ls" } } }] }, finishReason: "STOP" }],
      modelVersion: "gemini-pro-default",
    }]);
    expect(call.some((e) => e.content_block?.type === "tool_use")).toBe(true);
    expect(call.some((e) => e.delta?.type === "text_delta")).toBe(false);
  });

  // Regression, observed in production on 2026-08-14 against the deployed
  // fba16472: a complete four-stanza answer came back followed by a second
  // content block reading "returned a response with no content", and a second
  // message_stop. The finish branch closed the turn without marking it closed,
  // so the `[DONE]` that Gemini sends next reached finishStream — and by then
  // stopText had cleared textBlockStarted, so the liveness check reported an
  // empty turn. The tests above missed it because none of them sent a
  // terminator after a finishReason; real streams always do.
  for (const terminator of ["[DONE]", "data: [DONE]", null]) {
    it(`does not append an empty-turn notice when ${terminator ?? "a null chunk"} follows a complete reply`, () => {
      const out = drive([
        {
          candidates: [{ content: { parts: [{ text: "hello" }] }, finishReason: "STOP" }],
          modelVersion: "gemini-2.5-flash",
        },
        terminator,
      ]);

      const text = out.filter((e) => e.delta?.type === "text_delta").map((e) => e.delta.text).join("");
      expect(text).toBe("hello");
      expect(text).not.toContain("[9router]");
      expect(out.filter((e) => e.type === "message_stop")).toHaveLength(1);
      expect(out.filter((e) => e.type === "message_delta")).toHaveLength(1);
    });
  }

  it("does not append an empty-turn notice after a completed thinking-only turn", () => {
    const out = drive([
      {
        candidates: [{ content: { parts: [{ thought: true, text: "pondering" }] }, finishReason: "STOP" }],
        modelVersion: "gemini-2.5-flash",
      },
      "[DONE]",
    ]);

    const text = out.filter((e) => e.delta?.type === "text_delta").map((e) => e.delta.text).join("");
    expect(text).not.toContain("[9router]");
    expect(out.filter((e) => e.type === "message_stop")).toHaveLength(1);
  });

  // The guard must not swallow the case it was built for: a blocked candidate
  // still gets exactly one notice, not zero and not two.
  it("still emits exactly one notice when a blocked candidate is followed by [DONE]", () => {
    const out = drive([
      { candidates: [{ finishReason: "SAFETY" }], modelVersion: "gemini-2.5-flash" },
      "[DONE]",
    ]);

    const text = out.filter((e) => e.delta?.type === "text_delta").map((e) => e.delta.text).join("");
    expect(text).toContain("SAFETY");
    expect(text.match(/\[9router\]/g)).toHaveLength(1);
    expect(out.filter((e) => e.type === "message_stop")).toHaveLength(1);
  });
});
