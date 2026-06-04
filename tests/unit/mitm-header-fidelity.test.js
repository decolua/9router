import { describe, it, expect } from "vitest";
import { stripInternalRequestHeaders } from "../../src/mitm/headerFidelity.js";

describe("MITM header fidelity", () => {
  it("strips internal anti-loop headers before forwarding upstream", () => {
    const headers = stripInternalRequestHeaders({
      host: "cloudcode-pa.googleapis.com",
      "x-request-source": "local",
      authorization: "Bearer token",
      "user-agent": "antigravity/1.23.2 linux/x64"
    });

    expect(headers).toMatchObject({
      host: "cloudcode-pa.googleapis.com",
      authorization: "Bearer token",
      "user-agent": "antigravity/1.23.2 linux/x64"
    });
    expect(headers).not.toHaveProperty("x-request-source");
  });
});
