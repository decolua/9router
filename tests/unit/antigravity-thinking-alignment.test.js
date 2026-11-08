import { describe, it, expect } from "vitest";
import "../translator/registerAll.js";
import { getModelUpstreamId } from "../../open-sse/config/providerModels.js";
import { translateResponse, initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("Antigravity Thinking & Reasoning Effort Alignment", () => {
  describe("model upstream ID resolution for Gemini 4 Argon", () => {
    it("resolves bare gemini-4-argon to high tier by default", () => {
      const upstream = getModelUpstreamId("ag", "gemini-4-argon", {});
      expect(upstream).toBe("gemini-4-argon-high(high)");
    });

    it("resolves gemini-4-argon with reasoning_effort", () => {
      expect(getModelUpstreamId("ag", "gemini-4-argon", { reasoning_effort: "low" })).toBe("gemini-4-argon-low(low)");
      expect(getModelUpstreamId("ag", "gemini-4-argon", { reasoning_effort: "medium" })).toBe("gemini-4-argon-medium(medium)");
      expect(getModelUpstreamId("ag", "gemini-4-argon", { reasoning_effort: "high" })).toBe("gemini-4-argon-high(high)");
    });

    it("resolves gemini-4-argon with Claude output_config.effort", () => {
      expect(getModelUpstreamId("ag", "gemini-4-argon", { output_config: { effort: "low" } })).toBe("gemini-4-argon-low(low)");
      expect(getModelUpstreamId("ag", "gemini-4-argon", { output_config: { effort: "high" } })).toBe("gemini-4-argon-high(high)");
    });

    it("resolves gemini-4-argon with Claude adaptive thinking to high tier", () => {
      expect(getModelUpstreamId("ag", "gemini-4-argon", { thinking: { type: "adaptive" } })).toBe("gemini-4-argon-high(high)");
    });

    it("resolves gemini-4-argon with auto effort to high tier", () => {
      expect(getModelUpstreamId("ag", "gemini-4-argon", { reasoning_effort: "auto" })).toBe("gemini-4-argon-high(high)");
    });

    it("resolves gemini-4-argon with none/disabled effort to low tier (Argon minimum)", () => {
      expect(getModelUpstreamId("ag", "gemini-4-argon", { reasoning_effort: "none" })).toBe("gemini-4-argon-low(low)");
      expect(getModelUpstreamId("ag", "gemini-4-argon", { thinking: { type: "disabled" } })).toBe("gemini-4-argon-low(low)");
    });
  });

  describe("model upstream ID resolution for Claude 5.5 in Antigravity", () => {
    it("resolves claude-sonnet-5-5 with Claude adaptive thinking to high tier", () => {
      expect(getModelUpstreamId("ag", "claude-sonnet-5-5", { thinking: { type: "adaptive" } })).toBe("claude-sonnet-5-5-high(high)");
    });

    it("resolves claude-opus-5-5 with Claude adaptive thinking to high tier", () => {
      expect(getModelUpstreamId("ag", "claude-opus-5-5", { thinking: { type: "adaptive" } })).toBe("claude-opus-5-5-high(high)");
    });

    it("resolves claude-sonnet-5-5 with auto effort to high tier", () => {
      expect(getModelUpstreamId("ag", "claude-sonnet-5-5", { output_config: { effort: "auto" } })).toBe("claude-sonnet-5-5-high(high)");
    });

    it("resolves claude-sonnet-5-5 with minimal/none effort to low tier", () => {
      expect(getModelUpstreamId("ag", "claude-sonnet-5-5", { output_config: { effort: "minimal" } })).toBe("claude-sonnet-5-5-low(low)");
      expect(getModelUpstreamId("ag", "claude-sonnet-5-5", { reasoning_effort: "none" })).toBe("claude-sonnet-5-5-low(low)");
    });
  });

  describe("real-time thinking streaming back to Claude Code client", () => {
    it("streams thought: true chunks as thinking_delta events to Claude client", () => {
      const state = initState(FORMATS.CLAUDE);
      state.model = "gemini-4-argon-high";

      // Upstream chunk 1: model thinking
      const events1 = translateResponse(
        FORMATS.ANTIGRAVITY,
        FORMATS.CLAUDE,
        {
          response: {
            responseId: "resp-1",
            modelVersion: "gemini-4-argon-high",
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [{ text: "Analyzing the repository structure...", thought: true }],
                },
                index: 0,
              },
            ],
          },
        },
        state
      );

      // Verify thinking content block was started and delta emitted
      const blockStart = events1.find((e) => e.type === "content_block_start");
      expect(blockStart).toBeDefined();
      expect(blockStart.content_block.type).toBe("thinking");

      const delta = events1.find((e) => e.type === "content_block_delta");
      expect(delta).toBeDefined();
      expect(delta.delta.type).toBe("thinking_delta");
      expect(delta.delta.thinking).toBe("Analyzing the repository structure...");

      // Upstream chunk 2: model answers with normal text
      const events2 = translateResponse(
        FORMATS.ANTIGRAVITY,
        FORMATS.CLAUDE,
        {
          response: {
            responseId: "resp-1",
            modelVersion: "gemini-4-argon-high",
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [{ text: "Here is the answer." }],
                },
                index: 0,
              },
            ],
          },
        },
        state
      );

      // Verify thinking block was stopped and text block was started
      const blockStop = events2.find((e) => e.type === "content_block_stop");
      expect(blockStop).toBeDefined();

      const textBlockStart = events2.find(
        (e) => e.type === "content_block_start" && e.content_block.type === "text"
      );
      expect(textBlockStart).toBeDefined();

      const textDelta = events2.find((e) => e.type === "content_block_delta");
      expect(textDelta).toBeDefined();
      expect(textDelta.delta.type).toBe("text_delta");
      expect(textDelta.delta.text).toBe("Here is the answer.");
    });
  });
});
