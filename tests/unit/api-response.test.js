import { describe, expect, it } from "vitest";

import {
  getResponseErrorMessage,
  handleResponse,
  parseResponseBody,
} from "../../src/shared/utils/api.js";

describe("shared API response helpers", () => {
  it("parses JSON responses", async () => {
    const response = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    await expect(parseResponseBody(response)).resolves.toEqual({ ok: true });
  });

  it("turns non-JSON error responses into usable error data", async () => {
    const response = new Response("Internal Server Error", {
      status: 500,
      statusText: "Internal Server Error",
      headers: { "Content-Type": "text/plain" },
    });

    const data = await parseResponseBody(response);

    expect(data.error).toBe("Internal Server Error");
    expect(getResponseErrorMessage(response, data, "OAuth authorization failed")).toBe(
      "OAuth authorization failed (500 Internal Server Error): Internal Server Error"
    );
  });

  it("throws structured errors for JSON API failures", async () => {
    const response = new Response(JSON.stringify({ error: "Nope" }), {
      status: 400,
      statusText: "Bad Request",
      headers: { "Content-Type": "application/json" },
    });

    await expect(handleResponse(response)).rejects.toMatchObject({
      message: "An error occurred (400 Bad Request): Nope",
      status: 400,
      data: { error: "Nope" },
    });
  });
});
