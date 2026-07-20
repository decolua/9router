import { describe, expect, it } from "vitest";

import { getClientIp } from "@/lib/auth/loginLimiter.js";

const request = (headers) => ({ headers: new Headers(headers) });

describe("login limiter request origin", () => {
  it("trusts stamped peer identity only when the process proof is valid", () => {
    process.env.NINE_ROUTER_REQUEST_PROOF = "server-proof";

    expect(getClientIp(request({
      "x-9r-real-ip": "127.0.0.1",
      "x-9r-request-proof": "attacker-proof",
    }))).toBe("unknown");

    expect(getClientIp(request({
      "x-9r-real-ip": "203.0.113.20",
      "x-9r-request-proof": "server-proof",
    }))).toBe("203.0.113.20");
  });
});
