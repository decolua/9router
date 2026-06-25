import { describe, expect, it } from "vitest";
import { maskSensitiveHeaders } from "../../open-sse/utils/requestLogger.js";

describe("request logger", () => {
  it("masks secret headers before writing debug logs", () => {
    const masked = maskSensitiveHeaders({
      Authorization: "Bearer sk-secret-token-value",
      "x-api-key": "sk-api-key-value",
      Cookie: "session=very-secret-cookie",
      "Content-Type": "application/json",
    });

    expect(masked.Authorization).toContain("[redacted]");
    expect(masked.Authorization).not.toContain("secret-token");
    expect(masked["x-api-key"]).toContain("[redacted]");
    expect(masked.Cookie).toContain("[redacted]");
    expect(masked["Content-Type"]).toBe("application/json");
  });
});
