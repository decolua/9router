import { describe, expect, it } from "vitest";
import {
  hasUsableConnectionCredentials,
  needsConnectionReauth,
} from "../../src/lib/db/helpers/connectionCredentials.js";

describe("connection credential eligibility", () => {
  it("accepts API-key, cookie, and OAuth credential shapes", () => {
    expect(hasUsableConnectionCredentials({ authType: "apikey", apiKey: "sk-test" })).toBe(true);
    expect(hasUsableConnectionCredentials({ authType: "cookie", apiKey: "session=value" })).toBe(true);
    expect(hasUsableConnectionCredentials({ authType: "oauth", accessToken: "access" })).toBe(true);
    expect(hasUsableConnectionCredentials({ authType: "oauth", refreshToken: "refresh" })).toBe(true);
    expect(hasUsableConnectionCredentials({ authType: "access_token", idToken: "id" })).toBe(true);
  });

  it("quarantines rows without any credential material", () => {
    for (const authType of ["apikey", "cookie", "oauth", "access_token"]) {
      const connection = { authType, testStatus: "active" };
      expect(hasUsableConnectionCredentials(connection)).toBe(false);
      expect(needsConnectionReauth(connection)).toBe(true);
    }
  });
});
