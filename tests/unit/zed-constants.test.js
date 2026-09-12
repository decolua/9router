import { describe, it, expect } from "vitest";
import {
  ZED_PROVIDER,
  ZED_DEFAULT_PROVIDER,
  ZED_CLIENT_VERSION,
  ZED_COMPLETIONS_ACCEPT,
  resolveZedProvider,
  isNewerZedVersion,
  buildZedUnauthorizedMessage,
} from "../../open-sse/config/zedConstants.js";
import { openaiToZedRequest } from "../../open-sse/translator/request/openai-to-zed.js";
import { mapZedModel, normalizeZedAccessToken, buildZedUserAuthHeader } from "../../open-sse/shared/zedAuth.js";

describe("zedConstants wire protocol", () => {
  it("uses snake_case CompletionBody.provider tags (HTTP API contract)", () => {
    expect(ZED_PROVIDER).toEqual({
      anthropic: "anthropic",
      baseten: "baseten",
      openai: "open_ai",
      google: "google",
      xai: "x_ai",
    });
    expect(ZED_DEFAULT_PROVIDER).toBe("open_ai");
  });

  it("maps catalog provider strings to wire tags", () => {
    expect(resolveZedProvider("anthropic", null)).toBe("anthropic");
    expect(resolveZedProvider("Anthropic", null)).toBe("anthropic");
    expect(resolveZedProvider("open_ai", null)).toBe("open_ai");
    expect(resolveZedProvider("OpenAi", null)).toBe("open_ai");
    expect(resolveZedProvider("google", null)).toBe("google");
    expect(resolveZedProvider("x_ai", null)).toBe("x_ai");
    expect(resolveZedProvider("baseten", null)).toBe("baseten");
    expect(resolveZedProvider("Baseten", null)).toBe("baseten");
  });

  it("infers provider from model id when catalog omits provider", () => {
    expect(resolveZedProvider(null, "claude-sonnet-4-6")).toBe("anthropic");
    expect(resolveZedProvider(null, "gemini-2.5-flash")).toBe("google");
    expect(resolveZedProvider(null, "grok-3")).toBe("x_ai");
    expect(resolveZedProvider(null, "gpt-5-nano")).toBe("open_ai");
    expect(resolveZedProvider(null, "baseten-llama-4")).toBe("baseten");
  });

  it("openai-to-zed emits snake_case provider in CompletionBody", () => {
    const body = openaiToZedRequest(
      "claude-sonnet-4-6",
      { messages: [{ role: "user", content: "hi" }] },
      true,
    );
    expect(body.provider).toBe("anthropic");
    expect(body.provider_request?.model).toBe("claude-sonnet-4-6");
    expect(body.thread_id).toBeTruthy();
    expect(body.prompt_id).toBeTruthy();
  });

  it("keeps a current x-zed-version (not the stale 1.6.3 / 0.200 clients)", () => {
    expect(ZED_CLIENT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(ZED_CLIENT_VERSION).not.toBe("1.6.3");
    expect(isNewerZedVersion(ZED_CLIENT_VERSION, "1.6.3")).toBe(true);
  });

  it("advertises NDJSON for /completions", () => {
    expect(ZED_COMPLETIONS_ACCEPT).toMatch(/ndjson/);
  });

  it("compares dotted Zed versions", () => {
    expect(isNewerZedVersion("1.19.2", "1.6.3")).toBe(true);
    expect(isNewerZedVersion("1.6.3", "1.19.2")).toBe(false);
    expect(isNewerZedVersion("1.19.2", "1.19.2")).toBe(false);
  });
});

describe("mapZedModel", () => {
  it("unwraps string and newtype-object model ids", () => {
    expect(mapZedModel({ id: "claude-sonnet-4-6", display_name: "Sonnet", provider: "anthropic" })).toMatchObject({
      id: "claude-sonnet-4-6",
      name: "Sonnet",
      provider: "anthropic",
    });
    expect(mapZedModel({ id: { 0: "gpt-5" }, displayName: "GPT" })).toMatchObject({
      id: "gpt-5",
      name: "GPT",
    });
  });

  it("drops models with no id", () => {
    expect(mapZedModel({})).toBeNull();
  });
});

describe("normalizeZedAccessToken", () => {
  it("compacts keyring v2 JSON blobs", () => {
    const raw = `{ "version": 2, "id": "client_token_x", "token": "abcd" }`;
    expect(normalizeZedAccessToken(raw)).toBe(
      JSON.stringify({ version: 2, id: "client_token_x", token: "abcd" }),
    );
  });

  it("leaves plain tokens unchanged", () => {
    expect(normalizeZedAccessToken("plain-user-token")).toBe("plain-user-token");
  });

  it("puts compact v2 JSON in the user Authorization header", () => {
    const header = buildZedUserAuthHeader({
      accessToken: `{ "version": 2, "id": "client_token_x", "token": "abcd" }`,
      providerSpecificData: { userId: "123" },
    });
    expect(header).toBe('123 {"version":2,"id":"client_token_x","token":"abcd"}');
  });
});

describe("buildZedUnauthorizedMessage", () => {
  it("tells the user to browser-reconnect instead of re-importing a dead keyring token", () => {
    expect(buildZedUnauthorizedMessage()).toMatch(/Sign in with browser/i);
    expect(buildZedUnauthorizedMessage()).toMatch(/refresh token/i);
  });
});

