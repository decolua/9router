import { describe, it, expect } from "vitest";
import { maskSensitiveData } from "../../open-sse/dlp/index.js";

describe("dlp pipeline integration (pure)", () => {
  it("masks a Claude-shaped translated body in place", () => {
    const body = {
      model: "cc/claude-opus-5",
      messages: [{ role: "user", content: "call me on +55 11 91234-5678" }],
    };
    const stats = maskSensitiveData(body, {
      enabled: true, mode: "redact",
      types: ["phone"], customPatterns: [],
    });
    expect(stats.matched).toBe(1);
    expect(body.messages[0].content).toBe("call me on [PII-REDACTED]");
    expect(body.model).toBe("cc/claude-opus-5");
  });

  it("maskSensitiveData handles a Responses-shaped response body", () => {
    const body = {
      id: "resp_1",
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "cpf 529.982.247-25 found" }] }],
    };
    const stats = maskSensitiveData(body, { enabled: true, mode: "redact", types: ["cpf"], customPatterns: [] });
    expect(stats).not.toBeNull();
    expect(body.output[0].content[0].text).toBe("cpf [PII-REDACTED] found");
    expect(body.id).toBe("resp_1");
  });
});