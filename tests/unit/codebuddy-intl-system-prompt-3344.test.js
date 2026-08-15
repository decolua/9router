import { describe, expect, it } from "vitest";
import { CodeBuddyIntlExecutor } from "../../open-sse/executors/codebuddy-intl.js";

describe("CodeBuddyIntlExecutor system prompt handling (#3344)", () => {
  const executor = new CodeBuddyIntlExecutor();

  it("keeps caller system and developer instructions after the required CodeBuddy prompt", () => {
    const out = executor.transformRequest("glm-5.2", {
      messages: [
        { role: "system", content: "Follow the repository conventions." },
        { role: "developer", content: "Run targeted tests before replying." },
        { role: "user", content: "Fix the failing test." },
      ],
    }, true, {});

    expect(out.messages).toEqual([
      {
        role: "system",
        content: "You are CodeBuddy Code.\n\nFollow the repository conventions.\n\nRun targeted tests before replying.",
      },
      { role: "user", content: [{ type: "text", text: "Fix the failing test." }] },
    ]);
  });

  it("preserves text from typed system and developer content blocks", () => {
    const out = executor.transformRequest("glm-5.2", {
      messages: [
        {
          role: "system",
          content: [
            { type: "text", text: "First system instruction." },
            { type: "text", text: "Second system instruction." },
          ],
        },
        { role: "developer", content: [{ type: "input_text", text: "Developer instruction." }] },
        { role: "user", content: "Continue." },
      ],
    }, true, {});

    expect(out.messages[0]).toEqual({
      role: "system",
      content: "You are CodeBuddy Code.\n\nFirst system instruction.\nSecond system instruction.\n\nDeveloper instruction.",
    });
    expect(out.messages[1]).toEqual({ role: "user", content: [{ type: "text", text: "Continue." }] });
  });

  it("keeps the required CodeBuddy system prompt when the caller has no instructions", () => {
    const out = executor.transformRequest("glm-5.2", {
      messages: [{ role: "user", content: "Hello." }],
    }, true, {});

    expect(out.messages[0]).toEqual({ role: "system", content: "You are CodeBuddy Code." });
  });
});
