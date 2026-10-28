// Anthropic's current thinking signatures use a protobuf envelope (CAIS/CAQS):
// base64 starts with "C", decoded[0] == 0x08 (field 1 varint), and the classic
// 0x12 container only follows at offset 2. Treating those as foreign stripped
// every prior thinking block from Claude Code histories before they reached
// Anthropic. Foreign signatures from combo turns must still be dropped.
import { describe, it, expect } from "vitest";
import { normalizeClaudePassthrough, prepareClaudeRequest } from "../../open-sse/translator/formats/claude.js";
import {
  DEFAULT_THINKING_CLAUDE_SIGNATURE,
  DEFAULT_THINKING_GEMINI_CLI_SIGNATURE,
} from "../../open-sse/config/defaultThinkingSignature.js";

// Real claude-sonnet-5-5 signature (CAQS, envelope version 4) with its thinking
// text, taken verbatim from an omp session routed through cc/claude-sonnet-5-5.
const REAL_THINKING = "I should start by looking over the plan and the existing code to get my bearings.\n\n";
const REAL_CAQS_SIGNATURE = "CAQSsAUKEAgTGAI4AUIIdGhpbmtpbmcSDL3rwd2ZslatshEKGRoMV7gQL80NqI85/uS/IjD469t1TfonWX4atHHoDgDKIfOww42ZAjmP6/u8QHRoKyNJxJ/JLR+Nj5zFIftx9MQqzQSzi5wt4B4nnE+TwYGUy7wtmosb96AQ+KqvHMv/nmR/EYJycwEcivpX0GQE0Y/PW1F4OwcOvv/IHiGAWc0L+HaaHjFHWcy0qSHJSdg963wFqMoaDj+ucx7KUq/I4X23SnEioUXKe+Di4SCP7iSEh3NVg/HJbayfNmf66vDeK6ix/e+gaJIKZRkUH11T/H34oJ8XZid/Hw8hcG9gOPYdvSGXIKCXwuVxDPmRtsUnTLI5tbaourRSXnff1DATEdAiPA+5DVplXDz0EmWbUQHg0LByoNsLygUkF6TKK8vMKXG/OZ0rHoduxatQi7VxbIRSvIMNv0kxZOCQ2/ck+cYfwnDPj1zCmiIYmD3mc+vvjFU39ZobwMncsI1Go3zmzGis0KfnvyGJv0hS+cewj94d5p2pLuVg1g6+UOXKQjFgbITk8yWYonAFVxDwkcNZsI9NOoY0dXJpUew91c1LEIDdBwCpAUq2fKhKkpOgcI94tJbXAmsIRZqbP9pv0yM8U1+tP0yKCmZNYQbQklsPTYvdxIcx5FoYb2C57WnSlRfrwwTFPEfBSusFxmur8rX0OlZ6LMelSlxPuTqqe5VwebY8bnVznf+apIrHshmhtIo3FIFI6wyfDse+XgrxYWzQs00tEusyWLbJMGCbln1UZDOL3O3qnPuZyeNIQpEZzXe+4VizdFZFyAAPUG8F1YA4n2F7lGEgcjK0E8aQZV4YZgJgOS5aPG2fTJbDjMmqz7BgrsB8wdd7IxMA1vRxGxmJvl+fzqAi/OmJW0SnldFc2kJWGAE=";

// Real claude-sonnet-5 legacy E-form signature from an omp session; deliberately not
// the DEFAULT placeholder constant, so a kept prior block is distinguishable from it.
const REAL_E_SIGNATURE = "EvYHCpIECBIYAipAlQTZ2aV9gODwFVTK1cayMxorF6GCG0QITxYyS8QhALygEwhFhEj8NK0d7HTb0imGc+7wJfGqkWIjXSnZRXYe5DIPY2xhdWRlLXNvbm5ldC01OABCCHRoaW5raW5nWiQxYjE1NzI4Ny1mMDA0LTQ5NjctOTNhOC00N2JlZTZmOGJjYWVyEKBPmffhrXwJuxgfHKqvaTOIAQGaAREKD2NsYXVkZS1zb25uZXQtNagBo5nJ1gawAQLCAa4BCHUQTxpyCiJLCpaLA083CyokC6rCBCatCptxCrzAA083C5lKC70EBCatCtbQChs8A083C3caC5+KBCatCpWUA083C9WPBCatCtVeA083C9VuBCatCk0cCtg6A083C0VIC9cSBCatCgX6CgFkA083CwEACy0lBCatIAYqDANPNwXUFAWSlgUw5TIEEe1O9zoE9ZFe80IEEETKh0oEhGgimlAEWgTZBeFWYCRoAXAF2gGgAQoWcHJlZml4X2JlZm9yZV9ibG9ja192MRIg+wAPHw9qrb7K21EWeyy9OJ0rpEMHXpdSgLCE87Z8SSsiQBhrsB7vmnZ+Z25ZOax1rA4BWzaI65GusEymqbKpcjVGoHUgXASty/hvWdGME+J90Ux/gHg9Yc/Ar4YHCwo6vg4yIMLAE8hqnJLiL5ZvPYYXdo+LekTJAq3MCXv6HgmK+04fSAMSDJKTB74Rnthd3Th50xoMIdI6aRBMTu5MF8e/IjByyt1FbddXOV69e180HV3mr3iVGPvqygQwVpr1MvzqaziZ0haJ7zFnJsBUIvnvxpEqkANDG6XoOFFzBXoayyoleGQ3WOo1lwu3BLhMYh5kFh+K9WUHcSERUDaQEsJN1LnA2wlgypEdvnCLNFXfEYLzZP/Kj49q3Ycm1ahL2FXzqLzcIYIqD64OLwHe7YDhYU6FjHGFbkKc/t+uovLPi6R6RcT8E+q91npmUcIjOH8Hk7udxmpT6alRKio72HNgDMPkZmGS6paNzkBugEDDj0hnNy/wBuoBdXZNPwef7a3Pxz72P3kt9PAofMR4f2BYvZx7VwrDOh9MHD9mV2sHxNYbBEZXqNCYQYkuZ2Y5Ql1AXs7ol5MIQ4OqPFaOQuSoLsHcJIdU8XhatD46Gm3UeGPPxb4J5k2wy9F0s9ZJH5SQqtiUbrzO6CYxDsvTpm7Se5s9jdhPNunAMj/tlRH0mgHudgg4DLTTFSkee/a1Es1F0gNeh1ArhPlosQ6PbTJD3NeJlV7dkQW3M2mYFy349KHtq7VytsetqjySgHTL75nCwRd+lszYzCTpgXLHfh76q5r/u+AptPsRD7J0wj2pUGL0OkUgGAE=";

const toolUse = { type: "tool_use", id: "toolu_01", name: "Read", input: { path: "plan.md" } };

function history(thinkingBlock) {
  return {
    model: "claude-sonnet-5-5",
    max_tokens: 32000,
    thinking: { type: "enabled", budget_tokens: 16000 },
    messages: [
      { role: "user", content: [{ type: "text", text: "start" }] },
      { role: "assistant", content: [thinkingBlock, toolUse] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_01", content: "plan" }] },
    ],
  };
}

const realBlock = () => ({ type: "thinking", thinking: REAL_THINKING, signature: REAL_CAQS_SIGNATURE });
const b64 = (bytes) => Buffer.from(bytes).toString("base64");

describe("Claude CAIS/CAQS thinking signatures", () => {
  it("passthrough keeps a real C-form thinking block byte-identical", () => {
    const original = realBlock();
    const out = normalizeClaudePassthrough(history(realBlock()), "claude-sonnet-5-5");
    expect(out.messages[1].content).toEqual([original, toolUse]);
  });

  it("translated claude path keeps a real C-form thinking block", () => {
    const out = prepareClaudeRequest(history(realBlock()), "claude");
    const thinking = out.messages[1].content.find(b => b.type === "thinking");
    expect(thinking.signature).toBe(REAL_CAQS_SIGNATURE);
    expect(thinking.thinking).toBe(REAL_THINKING);
  });

  it("passthrough to a Claude model behind an anthropic-compatible gateway keeps the real block", () => {
    const original = realBlock();
    const out = normalizeClaudePassthrough(history(realBlock()), "anthropic/claude-opus-5-5");
    expect(out.messages[1].content).toEqual([original, toolUse]);
  });

  // Prior reasoning must not reach a non-Claude target, whatever its signature form.
  // With enabled thinking + tool_use the established placeholder (text ".", constant
  // DEFAULT_THINKING_CLAUDE_SIGNATURE) still precedes tool_use, as on master and as
  // prepareClaudeRequest sends to anthropic-compatible nodes; it carries no prior reasoning.
  it.each([
    { form: "C-form", signature: REAL_CAQS_SIGNATURE, model: "glm-5.3" },
    { form: "E-form", signature: REAL_E_SIGNATURE, model: "glm-5.3" },
    { form: "C-form", signature: REAL_CAQS_SIGNATURE, model: "claude-gw/glm-5.3" },
    { form: "C-form", signature: REAL_CAQS_SIGNATURE, model: "mimo-v2.5-pro-claude" },
  ])("passthrough drops Claude's $form thinking for non-Claude target $model", ({ signature, model }) => {
    const out = normalizeClaudePassthrough(history({ type: "thinking", thinking: REAL_THINKING, signature }), model);
    expect(out.messages[1].content).toEqual([
      { type: "thinking", thinking: ".", signature: DEFAULT_THINKING_CLAUDE_SIGNATURE },
      toolUse,
    ]);
  });

  it.each([
    ["Gemini CLI default (also C-prefixed)", DEFAULT_THINKING_GEMINI_CLI_SIGNATURE],
    ["random base64 starting with C", "CwtPtKDlJUsU0DlodR0cVa1iIbzNu5/41k9ByX9Qkjg="],
    ["0x08 envelope without container", b64([0x08, 0x04, 0x18, 0x01])],
    ["0x08 envelope whose container is not protobuf", b64([0x08, 0x04, 0x12, 0x05, 0x01, 0x02, 0x03, 0x04, 0x05])],
    ["real signature truncated", REAL_CAQS_SIGNATURE.slice(0, -8)],
  ])("drops a foreign signature: %s", (_label, signature) => {
    const out = normalizeClaudePassthrough(history({ type: "thinking", thinking: "foreign", signature }), "claude-sonnet-5-5");
    const content = out.messages[1].content;
    expect(content.map(b => b.type)).toEqual(["thinking", "tool_use"]);
    expect(content[0]).toEqual({ type: "thinking", thinking: ".", signature: DEFAULT_THINKING_CLAUDE_SIGNATURE });
  });

  it.each([
    ["E-form", DEFAULT_THINKING_CLAUDE_SIGNATURE],
    ["R-form", Buffer.from(DEFAULT_THINKING_CLAUDE_SIGNATURE).toString("base64")],
  ])("keeps legacy %s signatures", (_label, signature) => {
    const block = { type: "thinking", thinking: "legacy", signature };
    const out = normalizeClaudePassthrough(history({ ...block }), "claude-sonnet-5-5");
    expect(out.messages[1].content[0]).toEqual(block);
  });

  it("rejects a field-dense signature near the size limit without per-field allocation", () => {
    // 08 04 then ~12M empty varint fields (18 00) and no container: ~32 MB of base64.
    const bytes = Buffer.alloc(2 + 12_000_000 * 2);
    bytes[0] = 0x08;
    bytes[1] = 0x04;
    for (let i = 2; i < bytes.length; i += 2) bytes[i] = 0x18;
    const signature = bytes.toString("base64");
    const heapBefore = process.memoryUsage().heapUsed;
    const out = normalizeClaudePassthrough(history({ type: "thinking", thinking: "dense", signature }), "claude-sonnet-5-5");
    const heapGrowth = process.memoryUsage().heapUsed - heapBefore;
    expect(out.messages[1].content[0].signature).toBe(DEFAULT_THINKING_CLAUDE_SIGNATURE);
    expect(heapGrowth).toBeLessThan(64 * 1024 * 1024);
  });
});
