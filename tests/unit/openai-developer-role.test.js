import { describe, expect, it } from "vitest";
import { filterToOpenAIFormat } from "../../open-sse/translator/formats/openai.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateRequest } from "../../open-sse/translator/index.js";

describe("OpenAI developer role", () => {
  it("retains developer instructions when forwarding OpenAI to OpenAI", () => {
    const request = { messages: [{ role: "developer", content: "high-priority instruction" }, { role: "user", content: "hi" }] };
    const result = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, "gpt-5.5", request, false, null, "openai");
    expect(result.messages[0].role).toBe("developer");
  });

  it("keeps legacy system conversion available for other OpenAI-compatible targets", () => {
    const result = filterToOpenAIFormat({ messages: [{ role: "developer", content: "hi" }] });
    expect(result.messages[0].role).toBe("system");
  });
});
