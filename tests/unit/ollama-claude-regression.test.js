import { describe, expect, it } from "vitest";
import { resolveTransport, detectFormat, getTargetFormat } from "../../open-sse/services/provider.js";
import OllamaLocalExecutor from "../../open-sse/executors/ollama-local.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// Phase 4 VAL-01 + VAL-03: consolidate + clearly-label the regression + fallback
// guard already proven by Phase 1-3. Locks the passthrough contract against
// future refactors. No open-sse source changes.
//
// VAL-01: claude-format request to ollama resolves targetFormat=claude and the
// dispatched body is structurally identical to the client body (no openai
// intermediate hop). Phase 1 transport Contract A proves targetFormat=claude;
// Phase 2 block-fidelity proves field-level identity; VAL-01 formalizes it as a
// scoped deep-equal on the passthrough fields (comparing against a PRE-CALL
// snapshot — translateRequest mutates `body` in place, so the expected shape
// must be captured before the call) + negative assertions for OpenAI-only
// fields (choices / tool_calls / reasoning_effort / tools[*].function).
//
// prepareClaudeRequest (open-sse/translator/index.js:118-121, runs because
// targetFormat===CLAUDE) normalizes cache_control — system-array rewrite and
// message-block strip/re-add (COMP-01c/d). VAL-01's base assertion omits
// cache_control from the input body to keep the toMatchObject clean; a SEPARATE
// it block documents the cache_control interaction without false-asserting its
// identity (CONTEXT.md line 23 + Phase 3 COMP-01).
//
// VAL-03: non-Claude openai-format request to ollama resolves no claude
// transport and routes through /api/chat unchanged. Phase 1 Contract B+C proves
// the mechanics; this is the Phase 4 named guard locking the fallback (CONTEXT
// line 23, COMP WR-01).

describe("Phase 4: VAL-01 regression + VAL-03 fallback guard", () => {
  it("Contract VAL-01: dispatched body structurally identical to client body (no openai intermediate, ollama)", () => {
    const body = {
      model: "claude-sonnet-4-5",
      messages: [{ role: "user", content: "hi" }],
      system: "You are helpful",
      thinking: { type: "enabled" },
      output_config: { effort: "high" },
      tools: [{ name: "get_weather", input_schema: {} }],
    };

    // CR-01: translateRequest mutates `body` in place (let result = body at
    // translator/index.js:54 + prepareClaudeRequest adds cache_control to
    // tools[0]). Snapshot BEFORE the call so the expected shape reflects the
    // client's pre-translation body, not the mutated result ref.
    const snapshot = structuredClone(body);

    const result = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.CLAUDE,
      body.model,
      body,
      false,
      null,
      "ollama"
    );

    // Scoped deep-equal on the passthrough fields, against the PRE-CALL
    // snapshot. NOT a full toEqual — prepareClaudeRequest may add/normalize
    // headers, cache_control, anthropic-version.
    expect(result).toMatchObject({
      messages: snapshot.messages,
      system: snapshot.system,
      thinking: snapshot.thinking,
      output_config: snapshot.output_config,
      tools: snapshot.tools,
    });

    // WR-02: negative proof — never routed through OpenAI intermediate.
    // Assert the high-signal OpenAI-only fields that would appear if an
    // openai hop ran (choices, tool_calls, reasoning_effort, tools[*].function).
    expect(result).not.toHaveProperty("choices");
    expect(result.messages?.[0]).not.toHaveProperty("tool_calls");
    expect(result).not.toHaveProperty("reasoning_effort");
    // Claude tools keep input_schema; OpenAI shape is tools[*].function.parameters
    expect(result.tools?.[0]).not.toHaveProperty("function");
    expect(result.tools?.[0]?.input_schema).toBeDefined();
  });

  // Asymmetry vs VAL-01 (ollama): ollama-local traverses applyThinking's general
  // path (thinkingUnified.js:275 short-circuit is `provider === "ollama"` only —
  // the ponytail comment marks lifting to PROVIDERS[ollama].quirks when a second
  // native-claude provider lands). Consequence: thinking gets budget_tokens
  // normalized in and output_config (OpenAI-shaped) is stripped. The structural
  // passthrough still holds for messages/system/tools — that is the VAL-01
  // invariant; thinking/output_config normalization is documented, not asserted.
  it("Contract VAL-01 local: messages/system/tools structurally identical (no openai intermediate, ollama-local)", () => {
    const body = {
      model: "claude-sonnet-4-5",
      messages: [{ role: "user", content: "hi" }],
      system: "You are helpful",
      thinking: { type: "enabled" },
      output_config: { effort: "high" },
      tools: [{ name: "get_weather", input_schema: {} }],
    };

    // CR-01: snapshot before the call (translateRequest mutates body in place).
    const snapshot = structuredClone(body);

    const result = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.CLAUDE,
      body.model,
      body,
      false,
      null,
      "ollama-local"
    );

    expect(result).toMatchObject({
      messages: snapshot.messages,
      system: snapshot.system,
      tools: snapshot.tools,
    });
    // WR-02: negative proof — no OpenAI intermediate artifacts.
    expect(result).not.toHaveProperty("choices");
    expect(result.messages?.[0]).not.toHaveProperty("tool_calls");
    expect(result).not.toHaveProperty("reasoning_effort");
    expect(result.tools?.[0]).not.toHaveProperty("function");
    expect(result.tools?.[0]?.input_schema).toBeDefined();
  });

  // Cache_control scoping: prepareClaudeRequest (claude.js:241-244) strips
  // cache_control from message content blocks in Pass 1, then Pass 2 re-adds
  // {type:"ephemeral"} only to the last non-thinking block of the LAST
  // assistant with content. A user-only message has no assistant, so the strip
  // is permanent — locks COMP-01d (cache_control normalization is real, not
  // just documented). Scoped to ollama per CONTEXT line 23 + Phase 3 COMP-01.
  it("Contract VAL-01 cache_control: prepareClaudeRequest strips cache_control from user content blocks (COMP-01d)", () => {
    const body = {
      model: "claude-sonnet-4-5",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "hi", cache_control: { type: "ephemeral" } },
          ],
        },
      ],
    };

    const result = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.CLAUDE,
      body.model,
      body,
      false,
      null,
      "ollama"
    );

    // Text content survives — passthrough doesn't drop the message.
    expect(result.messages[0].content[0].text).toBe("hi");
    // CR-02: cache_control is actually stripped from user content blocks by
    // prepareClaudeRequest (no assistant → Pass 2 does not re-add it). Locks
    // COMP-01d: the strip is real, not just prose.
    expect(result.messages[0].content[0].cache_control).toBeUndefined();
  });

  it("Contract VAL-03: openai-format request to ollama routes /api/chat (full routing decision chain)", () => {
    // WR-01: reframe the Phase 1 Contract B/C duplicate to add incremental
    // value — assert the FULL routing decision chain end-to-end at the atom
    // level, not just the three atoms Phase 1 re-asserts. detectFormat proves
    // the openai body is classified as openai (not misdetected as claude);
    // resolveTransport null proves no claude transport matches an openai
    // source; getTargetFormat proves the non-Claude path's targetFormat is the
    // ollama format (Phase 1 buildUrl does not assert this). Together they lock
    // the fallback decision: openai body → no claude transport → ollama format
    // → /api/chat. Phase 1 transport Contract B/C owns the buildUrl atoms.
    const openaiBody = {
      model: "gpt-4",
      messages: [{ role: "user", content: "hi" }],
    };
    expect(detectFormat(openaiBody)).toBe("openai");
    expect(resolveTransport("ollama", "openai")).toBeNull();
    expect(resolveTransport("ollama-local", "openai")).toBeNull();
    expect(getTargetFormat("ollama")).toBe("ollama");

    const exec = new OllamaLocalExecutor();
    expect(exec.buildUrl("", true, 0, null)).toBe("http://localhost:11434/api/chat");

    // WR-03: positive claude-path buildUrl — the milestone's actual dependency.
    // Phase 1 Contract C covers this atom; re-asserted here as the positive
    // counterpart to the fallback above, proving the same executor picks
    // /v1/messages when a claude runtimeTransport is present.
    const claudeCreds = { runtimeTransport: { baseUrl: "http://localhost:11434/v1/messages", format: "claude" } };
    expect(exec.buildUrl("", true, 0, claudeCreds)).toBe("http://localhost:11434/v1/messages");
  });
});