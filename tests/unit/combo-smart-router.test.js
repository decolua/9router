import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  handleComboChat,
  getStickyComboModel,
  setStickyComboModel,
  clearStickyComboSession,
  orderModelsByChoice,
} from "../../open-sse/services/combo.js";

import {
  extractPromptState,
  buildChoiceCriteria,
  parseSystemOneRouteAnswer,
  resetStickyComboStore,
} from "../../open-sse/services/systemoneRouter.js";

const log = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

function okResponse(content = "ok") {
  const json = { choices: [{ message: { role: "assistant", content } }] };
  const make = () => ({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), clone: make, json: async () => json });
  return make();
}

function errResponse(status = 500, message = "error") {
  const json = { error: { message } };
  const make = () => ({ ok: false, status, headers: new Headers({ "content-type": "application/json" }), clone: make, json: async () => json });
  return make();
}

describe("System One Smart Combo Router", () => {
  beforeEach(() => {
    resetStickyComboStore();
  });

  describe("extractPromptState", () => {
    it("extracts the latest user turn from messages array", () => {
      const body = {
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "Write a quicksort in Rust" },
          { role: "assistant", content: "Sure, here it is..." },
          { role: "user", content: "Now optimize it with SIMD" },
        ],
      };
      expect(extractPromptState(body)).toBe("Now optimize it with SIMD");
    });

    it("extracts text from block-based content arrays", () => {
      const body = {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Parse this AST:" },
              { type: "text", text: "function foo() {}" },
            ],
          },
        ],
      };
      expect(extractPromptState(body)).toBe("Parse this AST: function foo() {}");
    });

    it("extracts from string prompt or input", () => {
      expect(extractPromptState({ prompt: "Hello world" })).toBe("Hello world");
      expect(extractPromptState({ input: "Codex prompt" })).toBe("Codex prompt");
    });

    it("truncates prompt state to maxChars cap", () => {
      const longText = "a".repeat(3000);
      const extracted = extractPromptState({ prompt: longText }, 500);
      expect(extracted.length).toBe(500);
    });
  });

  describe("buildChoiceCriteria", () => {
    it("maps model IDs to null values for System One native evaluation", () => {
      const models = ["ds/deepseek-v4", "cx/gpt-5-mini", "cc/claude-haiku-4"];
      expect(buildChoiceCriteria(models)).toEqual({
        "ds/deepseek-v4": null,
        "cx/gpt-5-mini": null,
        "cc/claude-haiku-4": null,
      });
    });
  });

  describe("parseSystemOneRouteAnswer", () => {
    it("parses valid route answer with choice, confidence and probabilities", () => {
      const payload = {
        answers: {
          route: {
            type: "choice",
            choice: "ds/deepseek-v4",
            confidence: 0.85,
            probabilities: {
              "ds/deepseek-v4": 0.85,
              "cx/gpt-5-mini": 0.15,
            },
          },
        },
      };
      const result = parseSystemOneRouteAnswer(payload);
      expect(result).toEqual({
        choice: "ds/deepseek-v4",
        confidence: 0.85,
        probabilities: {
          "ds/deepseek-v4": 0.85,
          "cx/gpt-5-mini": 0.15,
        },
      });
    });

    it("returns null on malformed or missing route answers", () => {
      expect(parseSystemOneRouteAnswer(null)).toBeNull();
      expect(parseSystemOneRouteAnswer({})).toBeNull();
      expect(parseSystemOneRouteAnswer({ answers: {} })).toBeNull();
      expect(parseSystemOneRouteAnswer({ answers: { route: { choice: "" } } })).toBeNull();
    });
  });

  describe("orderModelsByChoice", () => {
    it("places the selected model first and ranks remaining models by probability", () => {
      const models = ["cx/gpt-5-mini", "ds/deepseek-v4", "cc/claude-haiku-4"];
      const reordered = orderModelsByChoice(models, {
        choice: "ds/deepseek-v4",
        probabilities: {
          "ds/deepseek-v4": 0.7,
          "cc/claude-haiku-4": 0.25,
          "cx/gpt-5-mini": 0.05,
        },
      });
      expect(reordered).toEqual(["ds/deepseek-v4", "cc/claude-haiku-4", "cx/gpt-5-mini"]);
    });

    it("preserves model list if choice is not in models array", () => {
      const models = ["cx/gpt-5-mini", "ds/deepseek-v4"];
      const reordered = orderModelsByChoice(models, { choice: "unknown/model" });
      expect(reordered).toEqual(models);
    });
  });

  describe("Session Stickiness for Prompt Cache Retention", () => {
    it("maintains session stickiness to avoid cache thrashing across turns", () => {
      const models = ["ds/deepseek-v4", "cx/gpt-5-mini"];
      expect(getStickyComboModel("coding-combo", "sess-123", models)).toBeNull();

      setStickyComboModel("coding-combo", "sess-123", "ds/deepseek-v4");
      expect(getStickyComboModel("coding-combo", "sess-123", models)).toBe("ds/deepseek-v4");

      // Different session is isolated
      expect(getStickyComboModel("coding-combo", "sess-456", models)).toBeNull();

      // Clear session
      clearStickyComboSession("coding-combo", "sess-123");
      expect(getStickyComboModel("coding-combo", "sess-123", models)).toBeNull();
    });
  });

  describe("handleComboChat with smart strategy", () => {
    it("routes to the System One chosen model on Turn 1 and sticks to it on Turn 2", async () => {
      const calls = [];
      const handleSingleModel = vi.fn(async (_body, model) => {
        calls.push(model);
        return okResponse(`Answer from ${model}`);
      });

      const resolveSmartChoice = vi.fn(async () => ({
        choice: "ds/deepseek-v4",
        confidence: 0.9,
        probabilities: { "ds/deepseek-v4": 0.9, "cx/gpt-5-mini": 0.1 },
      }));

      // Turn 1
      const res1 = await handleComboChat({
        body: { messages: [{ role: "user", content: "Write a Rust binary search" }] },
        models: ["cx/gpt-5-mini", "ds/deepseek-v4"],
        handleSingleModel,
        log,
        comboName: "dev-combo",
        comboStrategy: "smart",
        sessionId: "session-abc",
        smartPolicy: "strict",
        resolveSmartChoice,
      });

      expect(res1.ok).toBe(true);
      expect(resolveSmartChoice).toHaveBeenCalledTimes(1);
      expect(calls[0]).toBe("ds/deepseek-v4");

      // Turn 2: same session, resolveSmartChoice should NOT be called again (strict policy!)
      const res2 = await handleComboChat({
        body: { messages: [{ role: "user", content: "Add unit tests for it" }] },
        models: ["cx/gpt-5-mini", "ds/deepseek-v4"],
        handleSingleModel,
        log,
        comboName: "dev-combo",
        comboStrategy: "smart",
        sessionId: "session-abc",
        smartPolicy: "strict",
        resolveSmartChoice,
      });

      expect(res2.ok).toBe(true);
      expect(resolveSmartChoice).toHaveBeenCalledTimes(1); // Still 1! Kept sticky!
      expect(calls[1]).toBe("ds/deepseek-v4");
    });

    it("fails open to default order if System One evaluation fails or times out", async () => {
      const calls = [];
      const handleSingleModel = vi.fn(async (_body, model) => {
        calls.push(model);
        return okResponse(`Answer from ${model}`);
      });

      const resolveSmartChoice = vi.fn(async () => null); // e.g. timeout / error

      const res = await handleComboChat({
        body: { messages: [{ role: "user", content: "Hello" }] },
        models: ["cx/gpt-5-mini", "ds/deepseek-v4"],
        handleSingleModel,
        log,
        comboName: "dev-combo",
        comboStrategy: "smart",
        sessionId: "session-failopen",
        resolveSmartChoice,
      });

      expect(res.ok).toBe(true);
      expect(calls[0]).toBe("cx/gpt-5-mini"); // Default first model
    });

    it("falls back to the next candidate and clears sticky lock if the chosen model fails", async () => {
      const calls = [];
      const handleSingleModel = vi.fn(async (_body, model) => {
        calls.push(model);
        if (model === "ds/deepseek-v4") {
          return errResponse(503, "Service Unavailable");
        }
        return okResponse(`Answer from ${model}`);
      });

      const resolveSmartChoice = vi.fn(async () => ({
        choice: "ds/deepseek-v4",
        probabilities: { "ds/deepseek-v4": 0.8, "cx/gpt-5-mini": 0.2 },
      }));

      const res = await handleComboChat({
        body: { messages: [{ role: "user", content: "High performance code" }] },
        models: ["cx/gpt-5-mini", "ds/deepseek-v4"],
        handleSingleModel,
        log,
        comboName: "dev-combo",
        comboStrategy: "smart",
        sessionId: "session-error-fallback",
        resolveSmartChoice,
      });

      expect(res.ok).toBe(true);
      expect(calls).toEqual(["ds/deepseek-v4", "cx/gpt-5-mini"]);
      // Because ds/deepseek-v4 failed, the sticky lock should have been cleared
      expect(getStickyComboModel("dev-combo", "session-error-fallback", ["cx/gpt-5-mini", "ds/deepseek-v4"])).toBeNull();
    });

    it("re-evaluates on each turn when sessionSticky is explicitly false", async () => {
      const calls = [];
      const handleSingleModel = vi.fn(async (_body, model) => {
        calls.push(model);
        return okResponse(`Answer from ${model}`);
      });

      let choice = "ds/deepseek-v4";
      const resolveSmartChoice = vi.fn(async () => ({
        choice,
        confidence: 0.9,
      }));

      // Turn 1
      await handleComboChat({
        body: { messages: [{ role: "user", content: "Task 1" }] },
        models: ["cx/gpt-5-mini", "ds/deepseek-v4"],
        handleSingleModel,
        log,
        comboName: "dev-combo",
        comboStrategy: "smart",
        sessionId: "session-nostick",
        sessionSticky: false,
        resolveSmartChoice,
      });

      expect(calls[0]).toBe("ds/deepseek-v4");
      expect(resolveSmartChoice).toHaveBeenCalledTimes(1);

      // Turn 2 with different decision
      choice = "cx/gpt-5-mini";
      await handleComboChat({
        body: { messages: [{ role: "user", content: "Task 2" }] },
        models: ["cx/gpt-5-mini", "ds/deepseek-v4"],
        handleSingleModel,
        log,
        comboName: "dev-combo",
        comboStrategy: "smart",
        sessionId: "session-nostick",
        sessionSticky: false,
        resolveSmartChoice,
      });

      expect(resolveSmartChoice).toHaveBeenCalledTimes(2);
      expect(calls[1]).toBe("cx/gpt-5-mini");
    });

    it("falls back to default order when decision confidence is below confidenceThreshold", async () => {
      const calls = [];
      const handleSingleModel = vi.fn(async (_body, model) => {
        calls.push(model);
        return okResponse(`Answer from ${model}`);
      });

      const resolveSmartChoice = vi.fn(async () => ({
        choice: "ds/deepseek-v4",
        confidence: 0.65, // Below 0.8
        probabilities: { "ds/deepseek-v4": 0.65, "cx/gpt-5-mini": 0.35 },
      }));

      await handleComboChat({
        body: { messages: [{ role: "user", content: "Vague task" }] },
        models: ["cx/gpt-5-mini", "ds/deepseek-v4"],
        handleSingleModel,
        log,
        comboName: "dev-combo",
        comboStrategy: "smart",
        sessionId: "session-conf",
        confidenceThreshold: 0.8,
        resolveSmartChoice,
      });

      expect(resolveSmartChoice).toHaveBeenCalledTimes(1);
      // Because confidence 0.65 < threshold 0.8, preserved default order (cx/gpt-5-mini first)
      expect(calls[0]).toBe("cx/gpt-5-mini");
    });

    it("supports strict lock policy: never calls router on subsequent turns", async () => {
      const calls = [];
      const handleSingleModel = vi.fn(async (_body, model) => {
        calls.push(model);
        return okResponse(`Answer from ${model}`);
      });

      const resolveSmartChoice = vi.fn(async () => ({
        choice: "ds/deepseek-v4",
        confidence: 0.9,
      }));

      // Turn 1
      await handleComboChat({
        body: { messages: [{ role: "user", content: "Initial task" }] },
        models: ["cx/gpt-5-mini", "ds/deepseek-v4"],
        handleSingleModel,
        log,
        comboName: "dev-combo",
        comboStrategy: "smart",
        sessionId: "session-strict",
        smartPolicy: "strict",
        resolveSmartChoice,
      });

      expect(resolveSmartChoice).toHaveBeenCalledTimes(1);
      expect(calls[0]).toBe("ds/deepseek-v4");

      // Turn 2: Strict lock means resolveSmartChoice is NOT called at all (+0ms latency)
      await handleComboChat({
        body: { messages: [{ role: "user", content: "Follow-up question" }] },
        models: ["cx/gpt-5-mini", "ds/deepseek-v4"],
        handleSingleModel,
        log,
        comboName: "dev-combo",
        comboStrategy: "smart",
        sessionId: "session-strict",
        smartPolicy: "strict",
        resolveSmartChoice,
      });

      expect(resolveSmartChoice).toHaveBeenCalledTimes(1); // Still exactly 1!
      expect(calls[1]).toBe("ds/deepseek-v4");
    });

    it("supports smart-switch adaptive hysteresis: retains cache on minor changes, switches on high confidence", async () => {
      const calls = [];
      const handleSingleModel = vi.fn(async (_body, model) => {
        calls.push(model);
        return okResponse(`Answer from ${model}`);
      });

      let currentDecision = {
        choice: "cx/gpt-5-mini",
        confidence: 0.85,
      };
      const resolveSmartChoice = vi.fn(async () => currentDecision);

      // Turn 1: selects gpt-5-mini
      await handleComboChat({
        body: { messages: [{ role: "user", content: "Explain async/await" }] },
        models: ["cx/gpt-5-mini", "ds/deepseek-v4"],
        handleSingleModel,
        log,
        comboName: "dev-combo",
        comboStrategy: "smart",
        sessionId: "session-adaptive",
        smartPolicy: "smart-switch",
        resolveSmartChoice,
      });

      expect(calls[0]).toBe("cx/gpt-5-mini");
      expect(resolveSmartChoice).toHaveBeenCalledTimes(1);

      // Turn 2: System One suggests deepseek, but confidence is only 0.65 (< 0.8 threshold)
      // Must RETAIN cx/gpt-5-mini to preserve warm prompt cache!
      currentDecision = {
        choice: "ds/deepseek-v4",
        confidence: 0.65,
      };

      await handleComboChat({
        body: { messages: [{ role: "user", content: "Can you give a quick example?" }] },
        models: ["cx/gpt-5-mini", "ds/deepseek-v4"],
        handleSingleModel,
        log,
        comboName: "dev-combo",
        comboStrategy: "smart",
        sessionId: "session-adaptive",
        smartPolicy: "smart-switch",
        resolveSmartChoice,
      });

      expect(resolveSmartChoice).toHaveBeenCalledTimes(2);
      expect(calls[1]).toBe("cx/gpt-5-mini"); // Retained! Cache protected.

      // Turn 3: User drastically changes task to complex SIMD / kernel hacking.
      // System One suggests deepseek with high confidence 0.95 (>= 0.8 threshold).
      // Must SWITCH to ds/deepseek-v4!
      currentDecision = {
        choice: "ds/deepseek-v4",
        confidence: 0.95,
      };

      await handleComboChat({
        body: { messages: [{ role: "user", content: "Now write an AVX-512 SIMD matrix multiply in assembly" }] },
        models: ["cx/gpt-5-mini", "ds/deepseek-v4"],
        handleSingleModel,
        log,
        comboName: "dev-combo",
        comboStrategy: "smart",
        sessionId: "session-adaptive",
        smartPolicy: "smart-switch",
        resolveSmartChoice,
      });

      expect(resolveSmartChoice).toHaveBeenCalledTimes(3);
      expect(calls[2]).toBe("ds/deepseek-v4"); // Switched!

      // Verify the session now holds deepseek as its new sticky model
      expect(getStickyComboModel("dev-combo", "session-adaptive", ["cx/gpt-5-mini", "ds/deepseek-v4"])).toBe("ds/deepseek-v4");
    });

    it("accepts chosen model when confidence meets or exceeds confidenceThreshold", async () => {
      const calls = [];
      const handleSingleModel = vi.fn(async (_body, model) => {
        calls.push(model);
        return okResponse(`Answer from ${model}`);
      });

      const resolveSmartChoice = vi.fn(async () => ({
        choice: "ds/deepseek-v4",
        confidence: 0.85, // Above 0.8
        probabilities: { "ds/deepseek-v4": 0.85, "cx/gpt-5-mini": 0.15 },
      }));

      await handleComboChat({
        body: { messages: [{ role: "user", content: "Clear coding task" }] },
        models: ["cx/gpt-5-mini", "ds/deepseek-v4"],
        handleSingleModel,
        log,
        comboName: "dev-combo",
        comboStrategy: "smart",
        sessionId: "session-conf-pass",
        confidenceThreshold: 0.8,
        resolveSmartChoice,
      });

      expect(resolveSmartChoice).toHaveBeenCalledTimes(1);
      expect(calls[0]).toBe("ds/deepseek-v4");
    });

    it("supports custom policy: applies user-specified confidence threshold", async () => {
      const calls = [];
      const handleSingleModel = vi.fn(async (_body, model) => {
        calls.push(model);
        return okResponse(`Answer from ${model}`);
      });

      let currentDecision = {
        choice: "cx/gpt-5-mini",
        confidence: 0.85,
      };
      const resolveSmartChoice = vi.fn(async () => currentDecision);

      // Turn 1
      await handleComboChat({
        body: { messages: [{ role: "user", content: "Initial task" }] },
        models: ["cx/gpt-5-mini", "ds/deepseek-v4"],
        handleSingleModel,
        log,
        comboName: "dev-combo",
        comboStrategy: "smart",
        sessionId: "session-custom",
        smartPolicy: "custom",
        confidenceThreshold: 0.75,
        resolveSmartChoice,
      });

      expect(calls[0]).toBe("cx/gpt-5-mini");

      // Turn 2: confidence is 0.76 (above 0.75 threshold) -> switches!
      currentDecision = {
        choice: "ds/deepseek-v4",
        confidence: 0.76,
      };

      await handleComboChat({
        body: { messages: [{ role: "user", content: "Different task" }] },
        models: ["cx/gpt-5-mini", "ds/deepseek-v4"],
        handleSingleModel,
        log,
        comboName: "dev-combo",
        comboStrategy: "smart",
        sessionId: "session-custom",
        smartPolicy: "custom",
        confidenceThreshold: 0.75,
        resolveSmartChoice,
      });

      expect(calls[1]).toBe("ds/deepseek-v4"); // Switched because 0.76 >= 0.75
    });
  });
});
