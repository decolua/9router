import { describe, expect, it } from "vitest";

import { createErrorResult } from "../../open-sse/utils/error.js";

describe("createErrorResult", () => {
  it("can expose a retryable client status while preserving provider status", async () => {
    const result = createErrorResult(502, "[400]: Bad Request", undefined, 400);

    expect(result.status).toBe(502);
    expect(result.accountStatus).toBe(400);
    expect(result.response.status).toBe(502);
    expect(await result.response.json()).toEqual({
      error: {
        message: "[400]: Bad Request",
        type: "server_error",
        code: "bad_gateway"
      }
    });
  });
});
