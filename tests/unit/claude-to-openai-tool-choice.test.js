// Claude `tool_choice: {type:"none"}` fell through convertToolChoice's default
// to "auto" on the claude→openai leg, turning "do not call tools" into
// "may call tools". OpenAI's native spelling for this is the string "none".
import { describe, expect, it } from "vitest";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const T = (toolChoice) =>
  translateRequest(
    FORMATS.CLAUDE,
    FORMATS.OPENAI,
    "m",
    {
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "f", description: "d", input_schema: { type: "object", properties: {} } }],
      tool_choice: toolChoice,
    },
    true,
    null,
    null
  );

describe("claude → openai tool_choice", () => {
  it("none stays none", () => {
    expect(T({ type: "none" }).tool_choice).toBe("none");
  });

  it("auto stays auto", () => {
    expect(T({ type: "auto" }).tool_choice).toBe("auto");
  });

  it("any becomes required", () => {
    expect(T({ type: "any" }).tool_choice).toBe("required");
  });

  it("tool becomes a named function choice", () => {
    expect(T({ type: "tool", name: "f" }).tool_choice).toEqual({
      type: "function",
      function: { name: "f" },
    });
  });
});
