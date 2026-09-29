import { describe, expect, it } from "vitest";
import { FreebuffExecutor } from "../../open-sse/executors/freebuff.js";

const MODEL = "deepseek/deepseek-v4-flash";
const CHAT_URL = "https://www.codebuff.com/api/v1/chat/completions";

describe("Freebuff transport artifact", () => {
  it("builds the golden Codebuff URL and auth headers (model is session-claim-only, not on chat)", () => {
    const executor = new FreebuffExecutor();
    const headers = executor.buildHeaders({ accessToken: "token-1" }, false);

    expect(executor.buildUrl()).toBe(CHAT_URL);
    expect(headers).toMatchObject({
      Authorization: "Bearer token-1",
      "User-Agent": "ai-sdk/openai-compatible/1.0/codebuff",
    });
    expect(headers["x-freebuff-model"]).toBeUndefined();
  });
});
