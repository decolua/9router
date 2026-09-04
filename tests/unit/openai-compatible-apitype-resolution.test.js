// Locks openai-compatible apiType resolution: the stored apiType on the
// connection's providerSpecificData (kept in sync with the node) is
// authoritative, and the node-ID substring is only a legacy fallback.
//
// Regression for: editing a node's apiType to "responses" had no effect because
// runtime derived chat/responses from the immutable node ID string
// (`openai-compatible-<chat|responses>-<uuid>`) instead of the stored value.
import { describe, it, expect } from "vitest";
import { resolveOpenAICompatibleApiType, resolveOpenAICompatibleFormat, getTargetFormat } from "../../open-sse/services/provider.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { BaseExecutor } from "../../open-sse/executors/base.js";

const CHAT_ID = "openai-compatible-chat-3d8d3de8-1206-47ee-a42f-22113a5f2387";
const RESPONSES_ID = "openai-compatible-responses-11111111-2222-3333-4444-555555555555";
const BASE = "https://api.ericding.io.vn/v1";
const TEST_MODEL = "test-model";

function creds(apiType) {
  return { providerSpecificData: apiType === undefined ? { baseUrl: BASE } : { baseUrl: BASE, apiType } };
}

describe("resolveOpenAICompatibleApiType", () => {
  it("prefers stored apiType over the ID substring (edited node on a legacy -chat- ID)", () => {
    expect(resolveOpenAICompatibleApiType(CHAT_ID, creds("responses"))).toBe("responses");
    expect(resolveOpenAICompatibleApiType(RESPONSES_ID, creds("chat"))).toBe("chat");
  });

  it("accepts auto as a stored API type", () => {
    expect(resolveOpenAICompatibleApiType(CHAT_ID, creds("auto"))).toBe("auto");
  });

  it("falls back to the ID substring when apiType is absent", () => {
    expect(resolveOpenAICompatibleApiType(CHAT_ID, creds(undefined))).toBe("chat");
    expect(resolveOpenAICompatibleApiType(RESPONSES_ID, creds(undefined))).toBe("responses");
    expect(resolveOpenAICompatibleApiType(CHAT_ID, null)).toBe("chat");
    expect(resolveOpenAICompatibleApiType(RESPONSES_ID, null)).toBe("responses");
  });

  it("ignores an invalid stored apiType and falls back to the ID", () => {
    expect(resolveOpenAICompatibleApiType(RESPONSES_ID, creds("bogus"))).toBe("responses");
    expect(resolveOpenAICompatibleApiType(CHAT_ID, creds(""))).toBe("chat");
  });
});

describe("getTargetFormat", () => {
  it("mirrors OpenAI client formats when apiType is auto", () => {
    expect(resolveOpenAICompatibleFormat(CHAT_ID, creds("auto"), "openai-responses")).toBe("openai-responses");
    expect(resolveOpenAICompatibleFormat(CHAT_ID, creds("auto"), "openai")).toBe("openai");
    expect(getTargetFormat(CHAT_ID, creds("auto"), "openai-responses")).toBe("openai-responses");
    expect(getTargetFormat(CHAT_ID, creds("auto"), "openai")).toBe("openai");
  });

  it("selects openai-responses when the stored apiType is responses (even on a -chat- ID)", () => {
    expect(getTargetFormat(CHAT_ID, creds("responses"))).toBe("openai-responses");
  });

  it("selects openai for chat, and honors stored chat over a -responses- ID", () => {
    expect(getTargetFormat(CHAT_ID, creds(undefined))).toBe("openai");
    expect(getTargetFormat(RESPONSES_ID, creds("chat"))).toBe("openai");
  });

  it("keeps the ID-based fallback when credentials are absent", () => {
    expect(getTargetFormat(RESPONSES_ID)).toBe("openai-responses");
    expect(getTargetFormat(CHAT_ID)).toBe("openai");
  });
});

describe("executor buildUrl endpoint path", () => {
  for (const [name, Ex] of [["DefaultExecutor", DefaultExecutor], ["BaseExecutor", BaseExecutor]]) {
    describe(name, () => {
      const ex = new Ex(CHAT_ID);

      it("routes to /responses when stored apiType is responses, despite the -chat- ID", () => {
        expect(ex.buildUrl(`cx/${TEST_MODEL}`, true, 0, creds("responses"))).toBe(`${BASE}/responses`);
      });

      it("routes to /chat/completions when apiType is chat", () => {
        expect(ex.buildUrl(`cx/${TEST_MODEL}`, true, 0, creds("chat"))).toBe(`${BASE}/chat/completions`);
      });

      it("routes auto mode from the per-request runtime format", () => {
        expect(ex.buildUrl(`cx/${TEST_MODEL}`, true, 0, { ...creds("auto"), runtimeFormat: "openai-responses" })).toBe(`${BASE}/responses`);
        expect(ex.buildUrl(`cx/${TEST_MODEL}`, true, 0, { ...creds("auto"), runtimeFormat: "openai" })).toBe(`${BASE}/chat/completions`);
      });

      it("falls back to the ID substring (legacy) when apiType is absent", () => {
        expect(ex.buildUrl(`cx/${TEST_MODEL}`, true, 0, creds(undefined))).toBe(`${BASE}/chat/completions`);
        const exResp = new Ex(RESPONSES_ID);
        expect(exResp.buildUrl("m", true, 0, creds(undefined))).toBe(`${BASE}/responses`);
      });
    });
  }
});
