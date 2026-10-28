import { describe, it, expect } from "vitest";
import { CodeBuddyExecutor } from "../../open-sse/executors/codebuddy-cn.js";
import { CodeBuddyIntlExecutor } from "../../open-sse/executors/codebuddy-intl.js";

describe("CodeBuddy channel verification (error 11128)", () => {
  it("sets required CLI and Stainless channel headers on codebuddy-cn and codebuddy-intl", () => {
    const cnExec = new CodeBuddyExecutor();
    const intlExec = new CodeBuddyIntlExecutor();

    const cnHeaders = cnExec.buildHeaders({ accessToken: "tok-cn" }, true, {});
    const intlHeaders = intlExec.buildHeaders({ accessToken: "tok-intl" }, true, {});

    expect(cnHeaders["User-Agent"]).toBe("CLI/2.108.1 CodeBuddy/2.108.1");
    expect(cnHeaders["X-App"]).toBe("cli");
    expect(cnHeaders["X-IDE-Type"]).toBe("CLI");
    expect(cnHeaders["X-IDE-Name"]).toBe("CLI");
    expect(cnHeaders["X-IDE-Version"]).toBe("2.108.1");
    expect(cnHeaders["X-Domain"]).toBe("copilot.tencent.com");
    expect(cnHeaders["X-Stainless-Lang"]).toBe("js");
    expect(cnHeaders["X-Request-ID"]).toMatch(/^[0-9a-f]{32}$/);
    expect(cnHeaders["X-Conversation-ID"]).toBeTruthy();
    expect(cnHeaders["X-Agent-Intent"]).toBe("craft");
    expect(cnHeaders["X-Agent-Purpose"]).toBe("conversation");

    expect(intlHeaders["User-Agent"]).toBe("CLI/2.108.1 CodeBuddy/2.108.1");
    expect(intlHeaders["X-Domain"]).toBe("www.codebuddy.ai");
    expect(intlHeaders["X-Request-ID"]).toMatch(/^[0-9a-f]{32}$/);
  });

  it("prepends 'You are CodeBuddy Code.', preserves caller system/developer instructions, and sanitizes external client markers", () => {
    const intlExec = new CodeBuddyIntlExecutor();
    const out = intlExec.transformRequest(
      "glm-5.2",
      {
        messages: [
          {
            role: "system",
            content:
              "You are Claude Code, Anthropic's official CLI for Claude.\nAlways reply in JSON.",
          },
          {
            role: "developer",
            content: "Follow strict schema rules.",
          },
          {
            role: "user",
            content: "hello",
          },
          {
            role: "assistant",
            content: "I am running with cc_entrypoint=cli",
          },
        ],
      },
      true,
      {}
    );

    expect(out.messages[0].role).toBe("system");
    expect(out.messages[0].content.startsWith("You are CodeBuddy Code.")).toBe(true);
    expect(out.messages[0].content).toContain("Always reply in JSON.");
    expect(out.messages[0].content).toContain("Follow strict schema rules.");
    expect(out.messages[0].content).not.toContain("You are Claude Code");

    expect(out.messages[1]).toEqual({
      role: "user",
      content: [{ type: "text", text: "hello" }],
    });
    expect(out.messages[2].content).not.toContain("cc_entrypoint=cli");
    expect(out.messages[2].content).toContain("[external-client-identity]");
  });
});
