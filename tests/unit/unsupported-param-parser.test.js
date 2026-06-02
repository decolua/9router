import { describe, expect, it } from "vitest";
import {
  extractUnsupportedParamFromResponse,
  extractUnsupportedParamFromText,
  parseErrorPayload
} from "../../open-sse/utils/unsupportedParam.js";

describe("unsupported parameter parser", () => {
  it("parses JSON error payloads", () => {
    const parsed = extractUnsupportedParamFromText(JSON.stringify({
      error: {
        code: "unsupported_parameter",
        param: "max_tokens",
        message: "Unsupported parameter: max_tokens. Use max_completion_tokens instead."
      }
    }));

    expect(parsed).toEqual({
      param: "max_tokens",
      msg: "unsupported parameter: max_tokens. use max_completion_tokens instead."
    });
  });

  it("extracts params from plain-text unsupported errors", () => {
    const parsed = extractUnsupportedParamFromText(
      "Unsupported parameter: 'max_tokens'. Use max_completion_tokens instead."
    );

    expect(parsed).toEqual({
      param: "max_tokens",
      msg: "unsupported parameter: 'max_tokens'. use max_completion_tokens instead."
    });
  });

  it("returns null for non-JSON unrelated errors", () => {
    expect(extractUnsupportedParamFromText("request failed")).toBeNull();
    expect(parseErrorPayload("not-json")).toBeNull();
  });

  it("ignores broad unsupported errors when no parameter name is present", () => {
    expect(extractUnsupportedParamFromText(JSON.stringify({
      error: {
        message: "This model is not supported for max_tokens or output limits."
      }
    }))).toBeNull();

    expect(extractUnsupportedParamFromText(
      "Unsupported feature for this model. Try a different model."
    )).toBeNull();
  });

  it("accepts recognized unsupported-param codes even without an extracted parameter", () => {
    expect(extractUnsupportedParamFromText(JSON.stringify({
      error: {
        code: "unsupported_parameter",
        message: "Unsupported parameter."
      }
    }))).toEqual({
      param: undefined,
      msg: "unsupported parameter."
    });
  });

  it("reads response text before applying the shared parser", async () => {
    const response = new Response("Unrecognized argument max_tokens", {
      status: 400,
      headers: { "Content-Type": "text/plain" }
    });

    expect(await extractUnsupportedParamFromResponse(response)).toEqual({
      param: "max_tokens",
      msg: "unrecognized argument max_tokens"
    });
  });
});
