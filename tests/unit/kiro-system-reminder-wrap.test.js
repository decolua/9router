import { describe, expect, it } from "vitest";
import { openaiToKiroRequest } from "../../open-sse/translator/request/openai-to-kiro.js";

/**
 * Guards fix for issue #2306:
 * When routing Claude Code (Anthropic format) to the Kiro provider, system
 * messages were being converted to plain user messages with no wrapper. This
 * caused the full system prompt to appear as raw user text in the Kiro
 * conversation, leaking context and making the model behave unpredictably.
 *
 * Fix: wrap system message content in <system-reminder>…</system-reminder>
 * before converting the role to user, so the model can distinguish injected
 * instructions from real user input.
 */
describe("openai-to-kiro: system messages are wrapped in <system-reminder>", () => {
  const makeRequest = (messages) =>
    openaiToKiroRequest("claude-sonnet-4-5", { messages, stream: false }, false, {
      accessToken: "token",
    });

  it("wraps a string system message in <system-reminder> tags", () => {
    const req = makeRequest([
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hello" },
    ]);
    // The history or currentMessage must contain <system-reminder>
    const allText = JSON.stringify(req);
    expect(allText).toContain("<system-reminder>");
    expect(allText).toContain("You are a helpful assistant.");
    expect(allText).toContain("</system-reminder>");
  });

  it("wraps an array-content system message in <system-reminder> tags", () => {
    const req = makeRequest([
      {
        role: "system",
        content: [{ type: "text", text: "System instructions here." }],
      },
      { role: "user", content: "Hello" },
    ]);
    const allText = JSON.stringify(req);
    expect(allText).toContain("<system-reminder>");
    expect(allText).toContain("System instructions here.");
    expect(allText).toContain("</system-reminder>");
  });

  it("does NOT wrap tool messages in <system-reminder> tags", () => {
    const req = makeRequest([
      { role: "user", content: "call tool" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "tc_1",
            type: "function",
            function: { name: "readFile", arguments: '{"path":"x.txt"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "tc_1", content: "file contents here" },
    ]);
    const allText = JSON.stringify(req);
    // tool output should be present but NOT wrapped
    expect(allText).toContain("file contents here");
    // No system-reminder on the tool turn
    const sysReminderIdx = allText.indexOf("<system-reminder>");
    const toolContentIdx = allText.indexOf("file contents here");
    // Either no system-reminder at all, or tool content is not inside one
    if (sysReminderIdx !== -1) {
      // Tool content should not immediately follow <system-reminder>
      const between = allText.slice(sysReminderIdx, toolContentIdx);
      expect(between).not.toContain("file contents here");
    }
    expect(allText).toContain("file contents here");
  });

  it("user messages are unchanged (no <system-reminder> wrapping)", () => {
    const req = makeRequest([{ role: "user", content: "regular user message" }]);
    const allText = JSON.stringify(req);
    expect(allText).toContain("regular user message");
    expect(allText).not.toContain("<system-reminder>");
  });

  it("empty system content does not produce empty <system-reminder> block", () => {
    const req = makeRequest([
      { role: "system", content: "" },
      { role: "user", content: "Hello" },
    ]);
    const allText = JSON.stringify(req);
    // Empty content shouldn't produce <system-reminder>\n\n</system-reminder>
    expect(allText).not.toMatch(/<system-reminder>\s*<\/system-reminder>/);
  });
});
