/**
 * Unit tests for open-sse/shared/commandCodeHeaders.js and its consumers.
 *
 * Target header set = command-code@1.88.0 buildCommandAuthHeaders():
 * User-Agent "cli", x-command-code-version, x-cli-environment "production",
 * x-cli-surface "cli", x-taste-learning, x-project-slug = slugify(cwd), x-session-id.
 */

import { describe, it, expect } from "vitest";
import {
  slugifyPath,
  toCommandCodeSessionUuid,
  buildCommandCodeHeaders,
  COMMAND_CODE_WORKING_DIR,
  COMMAND_CODE_PROJECT_SLUG,
} from "../../open-sse/shared/commandCodeHeaders.js";
import { CommandCodeExecutor } from "../../open-sse/executors/commandcode.js";
import { openaiToCommandCodeRequest } from "../../open-sse/translator/request/openai-to-commandcode.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("slugifyPath — parity with @sindresorhus/slugify defaults", () => {
  it.each([
    ["/home/bertho/proyek-web", "home-bertho-proyek-web"],
    ["/opt/data/tools/commandcode", "opt-data-tools-commandcode"],
    ["/home/user/Proyek Saya (2026)", "home-user-proyek-saya-2026"],
    ["/mnt/c/Users/Budi/My Project", "mnt-c-users-budi-my-project"],
    ["/root", "root"],
    ["", ""],
    ["útflækur", "utflaekur"],
    ["C:\\DEKSTOP\\9router", "c-dekstop-9router"],
    ["/home/u/MyProject", "home-u-my-project"],
    ["Déjà Vu!", "deja-vu"],
    ["I ♥ Dogs & Cats", "i-love-dogs-and-cats"],
  ])("%j → %j", (input, expected) => {
    expect(slugifyPath(input)).toBe(expected);
  });

  it("derives the project slug from the same dir the body reports", () => {
    expect(COMMAND_CODE_PROJECT_SLUG).toBe(slugifyPath(COMMAND_CODE_WORKING_DIR));
  });
});

describe("toCommandCodeSessionUuid", () => {
  it("is deterministic and UUID v4 shaped", () => {
    const a = toCommandCodeSessionUuid("session-abc");
    expect(a).toMatch(UUID_RE);
    expect(toCommandCodeSessionUuid("session-abc")).toBe(a);
    expect(toCommandCodeSessionUuid("session-xyz")).not.toBe(a);
  });

  it("falls back to a random UUID without a session", () => {
    expect(toCommandCodeSessionUuid(null)).toMatch(UUID_RE);
    expect(toCommandCodeSessionUuid(null)).not.toBe(toCommandCodeSessionUuid(null));
  });
});

describe("buildCommandCodeHeaders", () => {
  it("emits the official CLI header set", () => {
    const h = buildCommandCodeHeaders({ apiKey: "user_test", sessionId: "sid-1", accept: "text/event-stream" });
    expect(h).toEqual({
      "Content-Type": "application/json",
      "User-Agent": "cli",
      "x-command-code-version": "1.88.0",
      "x-cli-environment": "production",
      "x-cli-surface": "cli",
      "x-taste-learning": "false",
      "x-project-slug": COMMAND_CODE_PROJECT_SLUG,
      "x-session-id": "sid-1",
      "Authorization": "Bearer user_test",
      "Accept": "text/event-stream",
    });
  });

  it("never sends opencode-branded session headers", () => {
    const keys = Object.keys(buildCommandCodeHeaders({ apiKey: "k" })).map((k) => k.toLowerCase());
    expect(keys.some((k) => k.startsWith("x-opencode"))).toBe(false);
    expect(keys).not.toContain("x-session-affinity");
  });
});

describe("Command Code session continuity (translator → executor)", () => {
  const body = { messages: [{ role: "user", content: "hi" }] };

  it("keeps threadId stable for the same captured session", () => {
    const creds = { _clientSessionId: "conv-1" };
    const a = openaiToCommandCodeRequest("m", body, true, creds);
    const b = openaiToCommandCodeRequest("m", body, true, creds);
    expect(a.threadId).toMatch(UUID_RE);
    expect(b.threadId).toBe(a.threadId);
    expect(a.config.workingDir).toBe(COMMAND_CODE_WORKING_DIR);
  });

  it("sends x-session-id equal to the body threadId", () => {
    const translated = openaiToCommandCodeRequest("m", body, true, { _clientSessionId: "conv-2" });
    const headers = new CommandCodeExecutor().buildHeaders({ apiKey: "user_test" }, true, "", "m", translated);
    expect(headers["x-session-id"]).toBe(translated.threadId);
    expect(headers["Accept"]).toBe("text/event-stream");
  });
});
