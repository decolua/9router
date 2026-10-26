import { describe, it, expect } from "vitest";
import { foldSystemIntoFirstUser } from "../../open-sse/executors/qoder.js";

// #4995: the Qoder CN upstream ignores the top-level `system` field, while the
// same rule inside a user message is honoured. The executor folds it there.
describe("foldSystemIntoFirstUser (#4995)", () => {
  const msgs = () => [
    { role: "user", content: "BANANA test" },
    { role: "assistant", content: "ok" },
    { role: "user", content: "next" },
  ];

  it("prepends the system text to the first user message when content is a string", () => {
    const messages = msgs();
    expect(foldSystemIntoFirstUser(messages, "Answer only BANANA")).toBe(true);
    expect(messages[0].content).toBe("Answer only BANANA\n\nBANANA test");
    // later turns untouched
    expect(messages[2].content).toBe("next");
  });

  it("prepends a text block when the first user content is an array", () => {
    const messages = [{ role: "user", content: [{ type: "text", text: "look at this" }] }];
    expect(foldSystemIntoFirstUser(messages, "You are a reviewer")).toBe(true);
    expect(messages[0].content).toEqual([
      { type: "text", text: "You are a reviewer" },
      { type: "text", text: "look at this" },
    ]);
  });

  it("reports false and changes nothing when there is no system text", () => {
    const messages = msgs();
    const before = JSON.stringify(messages);
    expect(foldSystemIntoFirstUser(messages, "   ")).toBe(false);
    expect(JSON.stringify(messages)).toBe(before);
  });

  it("reports false when there is no user turn to fold into", () => {
    const messages = [{ role: "assistant", content: "hi" }];
    expect(foldSystemIntoFirstUser(messages, "rule")).toBe(false);
    expect(messages[0].content).toBe("hi");
  });

  it("preserves an empty string content instead of writing 'undefined'", () => {
    const messages = [{ role: "user", content: "" }];
    foldSystemIntoFirstUser(messages, "rule");
    expect(messages[0].content).toBe("rule\n\n");
  });
});
