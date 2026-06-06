import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildCasLoginUrl,
  buildCasValidationUrl,
  validateCasTicket,
} from "../../src/lib/auth/cas.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CAS auth helpers", () => {
  it("builds CAS login and validation URLs", () => {
    const serviceUrl = "https://router.example.com/api/auth/cas/callback?state=abc";

    expect(buildCasLoginUrl({
      serverUrl: "https://cas.example.com/cas/",
      serviceUrl,
    })).toBe("https://cas.example.com/cas/login?service=https%3A%2F%2Frouter.example.com%2Fapi%2Fauth%2Fcas%2Fcallback%3Fstate%3Dabc");

    expect(buildCasValidationUrl({
      serverUrl: "https://cas.example.com/cas/",
      validatePath: "p3/serviceValidate",
      serviceUrl,
      ticket: "ST-123",
    })).toBe("https://cas.example.com/cas/p3/serviceValidate?service=https%3A%2F%2Frouter.example.com%2Fapi%2Fauth%2Fcas%2Fcallback%3Fstate%3Dabc&ticket=ST-123");
  });

  it("validates CAS success responses with attributes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      text: async () => `
        <cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas">
          <cas:authenticationSuccess>
            <cas:user>alice</cas:user>
            <cas:attributes>
              <cas:displayName>Alice Chen</cas:displayName>
              <cas:mail>alice@example.com</cas:mail>
            </cas:attributes>
          </cas:authenticationSuccess>
        </cas:serviceResponse>
      `,
    })));

    const user = await validateCasTicket({
      serverUrl: "https://cas.example.com/cas",
      validatePath: "/p3/serviceValidate",
      serviceUrl: "https://router.example.com/api/auth/cas/callback?state=abc",
      ticket: "ST-123",
    });

    expect(user).toMatchObject({
      user: "alice",
      displayName: "Alice Chen",
      email: "alice@example.com",
    });
  });

  it("rejects CAS authentication failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      text: async () => `
        <cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas">
          <cas:authenticationFailure code="INVALID_TICKET">Ticket not recognized</cas:authenticationFailure>
        </cas:serviceResponse>
      `,
    })));

    await expect(validateCasTicket({
      serverUrl: "https://cas.example.com/cas",
      validatePath: "/p3/serviceValidate",
      serviceUrl: "https://router.example.com/api/auth/cas/callback?state=abc",
      ticket: "ST-bad",
    })).rejects.toThrow("Ticket not recognized");
  });
});

