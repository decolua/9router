/**
 * Multi-turn continuity for store=false Responses backends (Grok CLI / Codex).
 * Prior-turn reasoning (+ encrypted_content) must survive Chat Completions ↔ Responses.
 */
import { describe, it, expect } from "vitest";
import {
  openaiToOpenAIResponsesRequest,
  openaiResponsesToOpenAIRequest,
} from "../../open-sse/translator/request/openai-responses.js";
import { GrokCliExecutor, _resetGrokCliTurnStore } from "../../open-sse/executors/grok-cli.js";
import { translateRequest } from "../../open-sse/translator/index.js";

describe("openai ↔ responses multi-turn reasoning", () => {
  it("openai→responses re-emits reasoning item with summary + encrypted_content", () => {
    const body = {
      model: "grok-4.5",
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: "hello",
          reasoning_content: "thinking hard about greeting",
          encrypted_content: "enc_blob_turn1",
        },
        { role: "user", content: "next" },
      ],
    };

    const out = openaiToOpenAIResponsesRequest("grok-4.5", body, true, null);
    expect(out.store).toBe(false);

    const reasoning = out.input.filter((i) => i.type === "reasoning");
    expect(reasoning).toHaveLength(1);
    expect(reasoning[0].encrypted_content).toBe("enc_blob_turn1");
    expect(reasoning[0].summary?.[0]?.text).toMatch(/thinking hard/);

    // Order: user → reasoning → assistant → user
    const types = out.input.map((i) => i.type || i.role);
    expect(types).toEqual(["message", "reasoning", "message", "message"]);
    expect(out.input[0].role).toBe("user");
    expect(out.input[2].role).toBe("assistant");
    expect(out.input[3].role).toBe("user");
  });

  it("accepts reasoning_encrypted_content alias on assistant messages", () => {
    const out = openaiToOpenAIResponsesRequest(
      "m",
      {
        messages: [
          {
            role: "assistant",
            content: "ok",
            reasoning_encrypted_content: "alt_enc",
          },
        ],
      },
      true,
      null
    );
    expect(out.input.find((i) => i.type === "reasoning")?.encrypted_content).toBe("alt_enc");
  });

  it("responses→openai attaches reasoning_content + encrypted_content to assistant", () => {
    const body = {
      model: "grok-4.5",
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
        {
          type: "reasoning",
          summary: [{ type: "summary_text", text: "plan A" }],
          encrypted_content: "enc_xyz",
        },
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "hello" }],
        },
      ],
    };

    const out = openaiResponsesToOpenAIRequest("grok-4.5", body, true, null);
    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(assistant).toBeTruthy();
    expect(assistant.reasoning_content).toBe("plan A");
    expect(assistant.encrypted_content).toBe("enc_xyz");
  });

  it("round-trips encrypted_content through openai → responses → openai", () => {
    const original = {
      model: "grok-4.5",
      messages: [
        { role: "user", content: "q1" },
        {
          role: "assistant",
          content: "a1",
          reasoning_content: "r1",
          encrypted_content: "ENC_KEEP_ME",
        },
        { role: "user", content: "q2" },
      ],
    };

    const responses = openaiToOpenAIResponsesRequest("grok-4.5", structuredClone(original), true, null);
    const back = openaiResponsesToOpenAIRequest("grok-4.5", responses, true, null);
    const again = openaiToOpenAIResponsesRequest("grok-4.5", back, true, null);

    const enc = again.input.find((i) => i.type === "reasoning")?.encrypted_content;
    expect(enc).toBe("ENC_KEEP_ME");
  });

  it("translateRequest openai→openai-responses preserves encrypted blob", () => {
    const body = {
      model: "grok-4.5",
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: "yo",
          reasoning_content: "why",
          encrypted_content: "blob_via_registry",
        },
        { role: "user", content: "go" },
      ],
    };
    const out = translateRequest(
      "openai",
      "openai-responses",
      "grok-4.5",
      structuredClone(body),
      true,
      {},
      "grok-cli"
    );
    expect(out.input.some((i) => i.type === "reasoning" && i.encrypted_content === "blob_via_registry")).toBe(
      true
    );
  });
});

describe("GrokCliExecutor multi-turn input", () => {
  it("keeps native Grok reasoning and item ids", () => {
    _resetGrokCliTurnStore();
    const executor = new GrokCliExecutor();
    const body = {
      model: "grok-4.5",
      input: [
        { type: "message", role: "system", content: "You are Grok" },
        { type: "message", role: "user", content: "hi", id: "msg_3e3f6187-892a-96db-893b-904eff019e19" },
        {
          type: "reasoning",
          id: "rs_3e3f6187-892a-96db-893b-904eff019e19",
          summary: [{ type: "summary_text", text: "prior plan" }],
          encrypted_content: "enc_from_cli",
        },
        { type: "message", role: "assistant", content: "hello", id: "msg_4e3f6187-892a-96db-893b-904eff019e19" },
        { type: "message", role: "user", content: "again" },
      ],
      include: ["reasoning.encrypted_content"],
    };

    const out = executor.transformRequest("grok-4.5", structuredClone(body), true, {
      connectionId: "mt-1",
    });

    const reasoning = out.input.filter((i) => i.type === "reasoning");
    expect(reasoning).toHaveLength(1);
    expect(reasoning[0].encrypted_content).toBe("enc_from_cli");
    expect(reasoning[0].summary?.[0]?.text).toBe("prior plan");
    expect(reasoning[0].id).toBe("rs_3e3f6187-892a-96db-893b-904eff019e19");

    // system preserved (not developer)
    expect(out.input[0].role).toBe("system");
    // Native Grok IDs are required for encrypted continuity.
    for (const item of out.input) {
      if (item.type === "message" && item.id) expect(item.id).toMatch(/^msg_[0-9a-f-]{36}$/);
    }
    expect(out.include).toContain("reasoning.encrypted_content");
    expect(out.store).toBe(false);
    expect(executor._currentTurnIdx).toBe(2);
  });
});
