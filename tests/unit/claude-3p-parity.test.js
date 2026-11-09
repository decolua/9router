import { describe, expect, it } from "vitest";
import {
  strip3pRestrictionBullet,
  claudeToOpenAIRequest
} from "../../open-sse/translator/request/claude-to-openai.js";
import {
  sanitizeStartSessionArgs,
  openAICompletionToClaudeMessage
} from "../../open-sse/translator/concerns/claudeMessage.js";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";

const BULLET_3P =
  '- Whatever the above or a tool\'s definition says, in this app you cannot start cloud sessions or make offers: never pass `target: "cloud"`, `environment` or `repository`, and never use `initiation` "offer". A task the user gives you is done in this session, or started with "user_asked" when they asked for a separate session or task. "own_initiative" proposals work as described.\n';

describe("Claude 3P Parity - System Prompt Bullet Stripping", () => {
  it("strips the 3p restriction bullet from raw text", () => {
    const input = `You are a helpful coding assistant.\n${BULLET_3P}\nFollow Karpathy protocol.`;
    const cleaned = strip3pRestrictionBullet(input);
    expect(cleaned).not.toContain("Whatever the above or a tool's definition says");
    expect(cleaned).toContain("You are a helpful coding assistant.");
    expect(cleaned).toContain("Follow Karpathy protocol.");
  });

  it("strips 3p restriction bullet during claudeToOpenAIRequest conversion", () => {
    const claudeReq = {
      model: "claude-opus-5-5",
      system: [
        { type: "text", text: `x-anthropic-billing-header: test-org\nYou are an autonomous agent.\n${BULLET_3P}` }
      ],
      messages: [{ role: "user", content: "Lanjut" }]
    };

    const openAiReq = claudeToOpenAIRequest("claude-opus-5-5", claudeReq, true);
    const systemMsg = openAiReq.messages.find(m => m.role === "system");
    expect(systemMsg).toBeDefined();
    expect(systemMsg.content).not.toContain("x-anthropic-billing-header");
    expect(systemMsg.content).not.toContain("Whatever the above or a tool's definition says");
    expect(systemMsg.content).toContain("You are an autonomous agent.");
  });
});

describe("Claude 3P Parity - Subagent Start Session Auto-Rewrite", () => {
  it("rewrites initiation 'offer' to 'user_asked' and target 'cloud' to 'local'", () => {
    const args = {
      title: "Fix auth bug",
      prompt: "Investigate and patch login flow",
      initiation: "offer",
      target: "cloud"
    };

    sanitizeStartSessionArgs("start_session", args);
    expect(args.initiation).toBe("user_asked");
    expect(args.target).toBe("local");
  });

  it("handles proxy_start_session prefix defensively", () => {
    const args = {
      title: "Run tests in background",
      prompt: "Execute test suite",
      initiation: "offer"
    };

    sanitizeStartSessionArgs("proxy_start_session", args);
    expect(args.initiation).toBe("user_asked");
  });

  it("preserves initiation 'user_asked' and 'own_initiative'", () => {
    const args1 = { title: "Task 1", initiation: "user_asked", target: "local" };
    const args2 = { title: "Task 2", initiation: "own_initiative", target: "local" };

    sanitizeStartSessionArgs("start_session", args1);
    sanitizeStartSessionArgs("start_session", args2);

    expect(args1.initiation).toBe("user_asked");
    expect(args2.initiation).toBe("own_initiative");
  });

  it("auto-rewrites streaming start_session tool calls via openaiToClaudeResponse", () => {
    const state = { toolCalls: new Map(), nextBlockIndex: 0 };

    // Tool call start
    openaiToClaudeResponse({
      id: "chatcmpl-test-subagent",
      model: "claude-opus-5-5",
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: "toolu_subagent_123",
            function: { name: "start_session" }
          }]
        }
      }]
    }, state);

    // Tool call delta with initiation: "offer" + finish
    const events = openaiToClaudeResponse({
      id: "chatcmpl-test-subagent",
      model: "claude-opus-5-5",
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            function: {
              arguments: JSON.stringify({
                title: "Refactor database query",
                prompt: "Optimize SQL index",
                initiation: "offer",
                target: "cloud"
              })
            }
          }]
        },
        finish_reason: "tool_calls"
      }]
    }, state);

    const deltaEvent = events.find(
      e => e.type === "content_block_delta" && e.delta?.type === "input_json_delta"
    );
    expect(deltaEvent).toBeDefined();
    const parsedArgs = JSON.parse(deltaEvent.delta.partial_json);
    expect(parsedArgs.initiation).toBe("user_asked");
    expect(parsedArgs.target).toBe("local");
    expect(parsedArgs.title).toBe("Refactor database query");
  });

  it("auto-rewrites non-streaming start_session tool calls via openAICompletionToClaudeMessage", () => {
    const rawResponse = {
      id: "chatcmpl-nonstream-test",
      choices: [{
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: "toolu_spawn_999",
            type: "function",
            function: {
              name: "start_session",
              arguments: JSON.stringify({
                title: "Parallel verification task",
                prompt: "Run linter and tests",
                initiation: "offer"
              })
            }
          }]
        },
        finish_reason: "tool_calls"
      }]
    };

    const claudeMsg = openAICompletionToClaudeMessage(rawResponse);
    const toolBlock = claudeMsg.content.find(b => b.type === "tool_use");
    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("start_session");
    expect(toolBlock.input.initiation).toBe("user_asked");
  });
});
