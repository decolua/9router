import { describe, expect, it } from "vitest";
import * as requestOrigin from "@/lib/requestOrigin.js";

describe("request-origin header sanitization", () => {
  it("removes proof and peer metadata before request logging or provider use", () => {
    const headers = requestOrigin.getSafeRequestHeaders(new Request("https://router.test/v1/responses", {
      headers: {
        "user-agent": "codex_cli_rs/0.144.1",
        "x-9r-real-ip": "203.0.113.20",
        "x-9r-ip-source": "cloudflare",
        "x-9r-via-proxy": "1",
        "x-9r-request-proof": "process-secret-proof",
      },
    }));

    expect(headers).toEqual({ "user-agent": "codex_cli_rs/0.144.1" });
    expect(JSON.stringify(headers)).not.toContain("process-secret-proof");
    expect(JSON.stringify(headers)).not.toContain("203.0.113.20");
  });
});
