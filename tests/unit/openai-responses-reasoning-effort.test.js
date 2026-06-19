import { describe, expect, it } from "vitest";
import { convertResponsesApiFormat } from "../../open-sse/translator/helpers/responsesApiHelper.js";
import {
  openaiResponsesToOpenAIRequest,
  openaiToOpenAIResponsesRequest,
} from "../../open-sse/translator/request/openai-responses.js";

describe("OpenAI Responses reasoning effort translation", () => {
  it("preserves Responses API reasoning effort when converting to Chat Completions", () => {
    const body = openaiResponsesToOpenAIRequest("gpt-test", {
      input: "hello",
      reasoning: { effort: "high" },
    }, true, null);

    expect(body.reasoning_effort).toBe("high");
    expect(body.reasoning).toBeUndefined();
  });

  it("preserves reasoning effort in the shared Responses API helper", () => {
    const body = convertResponsesApiFormat({
      input: "hello",
      reasoning: { effort: "medium" },
    });

    expect(body.reasoning_effort).toBe("medium");
    expect(body.reasoning).toBeUndefined();
  });

  it("converts Chat Completions reasoning_effort to Responses API reasoning", () => {
    const body = openaiToOpenAIResponsesRequest("gpt-test", {
      messages: [{ role: "user", content: "hello" }],
      reasoning_effort: "xhigh",
    }, true, null);

    expect(body.reasoning).toEqual({ effort: "xhigh" });
  });
});
