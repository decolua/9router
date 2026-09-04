import { describe, expect, it } from "vitest";

import { createErrorResult, getClientErrorStatus, parseUpstreamError } from "../../open-sse/utils/error.js";

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

describe("getClientErrorStatus", () => {
  it("maps Cloudflare 524 to retryable 502", () => {
    expect(getClientErrorStatus(524)).toBe(502);
  });

  it("preserves standard upstream statuses", () => {
    expect(getClientErrorStatus(429)).toBe(429);
    expect(getClientErrorStatus(503)).toBe(503);
  });
});

describe("parseUpstreamError", () => {
  it("reduces a Cloudflare HTML error page to its title", async () => {
    const response = new Response(`<!DOCTYPE html>
      <html><head><title>524: A timeout occurred</title></head>
      <body><div>large Cloudflare error page</div></body></html>`, {
      status: 524,
      headers: { "Content-Type": "text/html; charset=UTF-8" }
    });

    const executor = {
      parseError: (_response, bodyText) => ({ status: 524, message: bodyText })
    };

    await expect(parseUpstreamError(response, executor)).resolves.toEqual({
      statusCode: 524,
      message: "524: A timeout occurred"
    });
  });

  it("does not expose an HTML body when no title exists", async () => {
    const response = new Response("<html><body>sensitive upstream details</body></html>", {
      status: 502,
      headers: { "Content-Type": "text/html" }
    });

    await expect(parseUpstreamError(response)).resolves.toEqual({
      statusCode: 502,
      message: "Upstream returned an HTML error page (502)"
    });
  });
});
