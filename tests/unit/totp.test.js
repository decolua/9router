import { describe, it, expect } from "vitest";
import { hotp, verifyTotp, generateTotpSecret } from "../../src/lib/auth/totp.js";

describe("totp", () => {
  it("generates and verifies a code for the current window", () => {
    const secret = generateTotpSecret();
    const code = hotp(secret, Math.floor(Date.now() / 1000 / 30));
    expect(verifyTotp(secret, code)).toBe(true);
  });

  it("rejects invalid codes", () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, "000000")).toBe(false);
  });
});
