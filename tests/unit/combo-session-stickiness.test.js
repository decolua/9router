import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  handleComboChat,
  getStickyComboModel,
  setStickyComboModel,
  clearStickyComboSession,
} from "../../open-sse/services/combo.js";

import { resetStickyComboStore } from "../../open-sse/services/systemoneRouter.js";
import { parseModel, getModelInfoCore } from "../../open-sse/services/model.js";
import { getModelInfo } from "../../src/sse/services/model.js";
import { enforceKeyAccess } from "../../src/sse/services/keyAccess.js";
import { resolveCaps } from "../../src/shared/hooks/useModelCaps.js";

const log = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

function okResponse(content = "ok") {
  const json = { choices: [{ message: { role: "assistant", content } }] };
  const make = () => ({
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    clone: make,
    json: async () => json,
  });
  return make();
}

function errResponse(status = 500, message = "error") {
  const json = { error: { message } };
  const make = () => ({
    ok: false,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    clone: make,
    json: async () => json,
  });
  return make();
}

describe("Combo Session Stickiness & Account Affinity (Issue #5215)", () => {
  beforeEach(() => {
    resetStickyComboStore();
  });

  describe("Fallback Strategy with stickySession", () => {
    it("pins fallback combo to successful fallback member on subsequent turns", async () => {
      const calls = [];
      const handleSingleModel = vi.fn(async (_body, model) => {
        calls.push(model);
        if (model === "primary/model") return errResponse(429, "Rate limited");
        return okResponse(`Answer from ${model}`);
      });

      const comboName = "fallback-sticky-test";
      const models = ["primary/model", "secondary/model"];

      // Turn 1: primary fails, secondary succeeds and anchors
      const res1 = await handleComboChat({
        body: { messages: [{ role: "user", content: "Turn 1" }] },
        models,
        handleSingleModel,
        log,
        comboName,
        comboStrategy: "fallback",
        sessionId: "sess-fb-1",
        stickySession: true,
      });

      expect(res1.ok).toBe(true);
      expect(calls).toEqual(["primary/model", "secondary/model"]);
      expect(getStickyComboModel(comboName, "sess-fb-1", models)).toBe("secondary/model");

      // Turn 2: secondary should be tried first (saving prompt cache & avoiding 429 on primary)
      const res2 = await handleComboChat({
        body: { messages: [{ role: "user", content: "Turn 2" }] },
        models,
        handleSingleModel,
        log,
        comboName,
        comboStrategy: "fallback",
        sessionId: "sess-fb-1",
        stickySession: true,
      });

      expect(res2.ok).toBe(true);
      expect(calls[2]).toBe("secondary/model");
    });

    it("does NOT pin fallback member when stickySession is false (default)", async () => {
      const calls = [];
      const handleSingleModel = vi.fn(async (_body, model) => {
        calls.push(model);
        if (model === "primary/model") return errResponse(429, "Rate limited");
        return okResponse(`Answer from ${model}`);
      });

      const comboName = "fallback-nosticky-test";
      const models = ["primary/model", "secondary/model"];

      // Turn 1
      await handleComboChat({
        body: { messages: [{ role: "user", content: "Turn 1" }] },
        models,
        handleSingleModel,
        log,
        comboName,
        comboStrategy: "fallback",
        sessionId: "sess-fb-2",
        stickySession: false,
      });

      expect(calls).toEqual(["primary/model", "secondary/model"]);
      expect(getStickyComboModel(comboName, "sess-fb-2", models)).toBeNull();

      // Turn 2: tries primary again because stickiness is off
      await handleComboChat({
        body: { messages: [{ role: "user", content: "Turn 2" }] },
        models,
        handleSingleModel,
        log,
        comboName,
        comboStrategy: "fallback",
        sessionId: "sess-fb-2",
        stickySession: false,
      });

      expect(calls.slice(2)).toEqual(["primary/model", "secondary/model"]);
    });
  });

  describe("Round-Robin Strategy with stickySession", () => {
    it("pins round-robin session to chosen member and balances separate sessions across pool", async () => {
      const calls = [];
      const handleSingleModel = vi.fn(async (_body, model) => {
        calls.push(model);
        return okResponse(`Answer from ${model}`);
      });

      const comboName = "rr-sticky-test";
      const models = ["acc1/gpt-5", "acc2/gpt-5", "acc3/gpt-5"];

      // Session A Turn 1: Round-robin picks acc1
      await handleComboChat({
        body: { messages: [{ role: "user", content: "User A1" }] },
        models,
        handleSingleModel,
        log,
        comboName,
        comboStrategy: "round-robin",
        sessionId: "sess-user-a",
        stickySession: true,
      });
      expect(calls[0]).toBe("acc1/gpt-5");

      // Session B Turn 1: Round-robin picks acc2
      await handleComboChat({
        body: { messages: [{ role: "user", content: "User B1" }] },
        models,
        handleSingleModel,
        log,
        comboName,
        comboStrategy: "round-robin",
        sessionId: "sess-user-b",
        stickySession: true,
      });
      expect(calls[1]).toBe("acc2/gpt-5");

      // Session A Turn 2: Stays pinned to acc1
      await handleComboChat({
        body: { messages: [{ role: "user", content: "User A2" }] },
        models,
        handleSingleModel,
        log,
        comboName,
        comboStrategy: "round-robin",
        sessionId: "sess-user-a",
        stickySession: true,
      });
      expect(calls[2]).toBe("acc1/gpt-5");

      // Session B Turn 2: Stays pinned to acc2
      await handleComboChat({
        body: { messages: [{ role: "user", content: "User B2" }] },
        models,
        handleSingleModel,
        log,
        comboName,
        comboStrategy: "round-robin",
        sessionId: "sess-user-b",
        stickySession: true,
      });
      expect(calls[3]).toBe("acc2/gpt-5");
    });

    it("unpins and re-anchors to next member if the pinned member fails on subsequent turn", async () => {
      const calls = [];
      let failAcc1 = false;
      const handleSingleModel = vi.fn(async (_body, model) => {
        calls.push(model);
        if (model === "acc1/gpt-5" && failAcc1) {
          return errResponse(503, "Service Unavailable");
        }
        return okResponse(`Answer from ${model}`);
      });

      const comboName = "rr-reanchor-test";
      const models = ["acc1/gpt-5", "acc2/gpt-5"];

      // Turn 1: acc1 succeeds and becomes pinned
      await handleComboChat({
        body: { messages: [{ role: "user", content: "Turn 1" }] },
        models,
        handleSingleModel,
        log,
        comboName,
        comboStrategy: "round-robin",
        sessionId: "sess-reanchor",
        stickySession: true,
      });
      expect(calls[0]).toBe("acc1/gpt-5");

      // Turn 2: acc1 fails with 503 -> falls back to acc2 and re-anchors
      failAcc1 = true;
      await handleComboChat({
        body: { messages: [{ role: "user", content: "Turn 2" }] },
        models,
        handleSingleModel,
        log,
        comboName,
        comboStrategy: "round-robin",
        sessionId: "sess-reanchor",
        stickySession: true,
      });
      expect(calls[1]).toBe("acc1/gpt-5");
      expect(calls[2]).toBe("acc2/gpt-5");

      // Turn 3: Session now starts on acc2 directly (even if acc1 recovered)
      failAcc1 = false;
      await handleComboChat({
        body: { messages: [{ role: "user", content: "Turn 3" }] },
        models,
        handleSingleModel,
        log,
        comboName,
        comboStrategy: "round-robin",
        sessionId: "sess-reanchor",
        stickySession: true,
      });
      expect(calls[3]).toBe("acc2/gpt-5");
    });
  });

  describe("Account Affinity Model Parsing & Capabilities", () => {
    it("parses model strings with connection affinity suffix cleanly", () => {
      const parsed = parseModel("codex/gpt-5@conn-user-1234");
      expect(parsed.provider).toBe("codex");
      expect(parsed.model).toBe("gpt-5");
      expect(parsed.connectionId).toBe("conn-user-1234");
    });

    it("parses standard model strings without connectionId", () => {
      const parsed = parseModel("openai/gpt-4o");
      expect(parsed.provider).toBe("openai");
      expect(parsed.model).toBe("gpt-4o");
      expect(parsed.connectionId).toBeUndefined();
    });

    it("preserves Cloudflare AI models (@cf/...) without mistaking prefix for connectionId", () => {
      const parsed = parseModel("cf/@cf/meta/llama-3-8b-instruct");
      expect(parsed.provider).toBe("cloudflare-ai");
      expect(parsed.model).toBe("@cf/meta/llama-3-8b-instruct");
      expect(parsed.connectionId).toBeUndefined();
    });

    it("supports connection affinity on Cloudflare AI models", () => {
      const parsed = parseModel("cf/@cf/meta/llama-3-8b-instruct@conn-cf-prod");
      expect(parsed.provider).toBe("cloudflare-ai");
      expect(parsed.model).toBe("@cf/meta/llama-3-8b-instruct");
      expect(parsed.connectionId).toBe("conn-cf-prod");
    });

    it("resolveCaps cleanly strips connection affinity to look up model capabilities", () => {
      const byFull = { "codex/gpt-5": { vision: true, reasoning: true, contextWindow: 128000 } };
      const caps = resolveCaps(byFull, {}, "codex/gpt-5@conn-user-1234");
      expect(caps.vision).toBe(true);
      expect(caps.reasoning).toBe(true);
      expect(caps.contextWindow).toBe(128000);
    });
  });

  describe("API Key Model Access Control with Connection Affinity", () => {
    it("allows request with connection affinity when key allows the canonical model", async () => {
      const ctx = {
        keyName: "TestKey",
        allow: ["codex/gpt-5"],
      };

      const result = await enforceKeyAccess(ctx, "codex/gpt-5@conn-user-1234");
      expect(result).toBeNull(); // null means allowed
    });

    it("allows request when key specifically specifies connection affinity", async () => {
      const ctx = {
        keyName: "PinnedKey",
        allow: ["codex/gpt-5@conn-work-account"],
      };

      const allowed = await enforceKeyAccess(ctx, "codex/gpt-5@conn-work-account");
      expect(allowed).toBeNull();
    });
  });
});
