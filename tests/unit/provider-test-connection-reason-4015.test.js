import { describe, expect, it, vi } from "vitest";

// Issue #4015: "Test connection" reported only that it failed. Anything that THREW out of
// testSingleConnection — a DNS timeout, an OAuth token exchange, an upstream 401 — was
// flattened to "Test failed", and the reason existed only in the server log. The dashboard
// renders `data.error` whatever the status, so carrying the reason in that field is enough
// to put it in front of the user.

const testSingleConnection = vi.fn();
vi.mock("../../src/app/api/providers/[id]/test/testUtils.js", () => ({ testSingleConnection }));

const { POST } = await import("../../src/app/api/providers/[id]/test/route.js");

function call() {
  return POST(new Request("http://localhost/api/providers/c1/test", { method: "POST" }), {
    params: Promise.resolve({ id: "c1" }),
  });
}

describe("provider test connection surfaces why it failed (#4015)", () => {
  it("carries the thrown reason instead of a bare 'Test failed'", async () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    testSingleConnection.mockRejectedValueOnce(timeout);

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toContain("The operation was aborted due to timeout");
  });

  it("redacts a token the upstream error quoted back", async () => {
    // An OAuth failure body can repeat the credential that was just exchanged.
    testSingleConnection.mockRejectedValueOnce(
      new Error('Token exchange failed: {"error":"invalid_grant"} Bearer ya29.a0AfB_secret_value'),
    );

    const res = await call();
    const body = await res.json();

    expect(body.error).toContain("invalid_grant");
    expect(body.error).toContain("Bearer [redacted]");
    expect(body.error).not.toContain("ya29.a0AfB_secret_value");
  });

  it("still answers 404 for a connection that does not exist", async () => {
    testSingleConnection.mockResolvedValueOnce({ valid: false, error: "Connection not found" });

    const res = await call();

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Connection not found");
  });

  it("passes a structured test result through unchanged", async () => {
    // The non-throwing paths already reported a reason; this pins that they still do.
    testSingleConnection.mockResolvedValueOnce({ valid: false, error: "Token invalid or revoked" });

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ valid: false, error: "Token invalid or revoked", refreshed: false });
  });
});
