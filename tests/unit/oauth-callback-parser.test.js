import { describe, it, expect } from "vitest";
import { parseOAuthCallbackInput } from "../../src/lib/oauth/utils/callbackParser.js";

describe("OAuth Callback Input Parser", () => {
  it("parses full callback URL with localhost port", () => {
    const input = "http://localhost:20128/callback?code=4%2F0AY0e_test&state=abc-123";
    const result = parseOAuthCallbackInput(input);
    expect(result.code).toBe("4/0AY0e_test");
    expect(result.state).toBe("abc-123");
  });

  it("parses scheme-less localhost callback URL", () => {
    const input = "127.0.0.1:20128/callback?code=4%2F0AY0e_test&state=abc-123";
    const result = parseOAuthCallbackInput(input);
    expect(result.code).toBe("4/0AY0e_test");
    expect(result.state).toBe("abc-123");
  });

  it("parses raw Google auth code starting with 4/", () => {
    const input = "4/0AY0e-raw-google-code";
    const result = parseOAuthCallbackInput(input);
    expect(result.code).toBe("4/0AY0e-raw-google-code");
  });

  it("parses URL-encoded Google auth code starting with 4%2F", () => {
    const input = "4%2F0AY0e-raw-google-code";
    const result = parseOAuthCallbackInput(input);
    expect(result.code).toBe("4/0AY0e-raw-google-code");
  });

  it("parses raw Google refresh token starting with 1//", () => {
    const input = "1//04test_refresh_token";
    const result = parseOAuthCallbackInput(input);
    expect(result.code).toBe("1//04test_refresh_token");
    expect(result.token).toBe("1//04test_refresh_token");
  });

  it("parses raw Google access token starting with ya29.", () => {
    const input = "ya29.a0test_access_token";
    const result = parseOAuthCallbackInput(input);
    expect(result.code).toBe("ya29.a0test_access_token");
    expect(result.token).toBe("ya29.a0test_access_token");
  });

  it("parses raw credentials JSON string", () => {
    const json = JSON.stringify({ refresh_token: "1//04json_token" });
    const result = parseOAuthCallbackInput(json);
    expect(result.code).toBe(json);
    expect(result.token).toBe(json);
  });

  it("throws descriptive error when input is empty", () => {
    expect(() => parseOAuthCallbackInput("")).toThrow("Paste the callback URL from the address bar");
    expect(() => parseOAuthCallbackInput("   ")).toThrow("Paste the callback URL from the address bar");
  });
});
