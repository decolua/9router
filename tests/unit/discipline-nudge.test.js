import { beforeEach, describe, expect, it } from "vitest";
import { clearDisciplineStrikes, recordStrike } from "../../open-sse/utils/discipline.js";
import { disciplineKey, injectDisciplineNudge } from "../../open-sse/rtk/disciplineNudge.js";

describe("discipline nudge injection", () => {
  beforeEach(() => {
    clearDisciplineStrikes();
  });

  it("keys strikes exactly as stream.js builds servingModel", () => {
    expect(disciplineKey("oc", "mimo-v2.5-free")).toBe("oc/mimo-v2.5-free");
    expect(disciplineKey(null, "solo-model")).toBe("solo-model");
    expect(disciplineKey(undefined, undefined)).toBe(undefined);
  });

  // NOTE: these use real time on purpose — consumeNudge() defaults to
  // Date.now(), so a strike stamped at t=0 reads as expired and is evicted
  // before the nudge can be consumed. Production always records with real time.
  it("injects once after a strike, then not again", () => {
    recordStrike("oc/mimo", "doubled-json");

    const first = { messages: [] };
    expect(injectDisciplineNudge(first, "openai", "oc", "mimo")).toBe(true);
    expect(JSON.stringify(first)).toContain("Output discipline");

    const second = { messages: [] };
    expect(injectDisciplineNudge(second, "openai", "oc", "mimo")).toBe(false);
    expect(JSON.stringify(second)).not.toContain("Output discipline");
  });

  it("does not inject for a model with no strikes", () => {
    const body = { messages: [] };
    expect(injectDisciplineNudge(body, "openai", "oc", "clean")).toBe(false);
    expect(body.messages).toHaveLength(0);
  });

  it("nudges on echo strikes without ever locking the model", () => {
    recordStrike("oc/echoer", "echo");
    recordStrike("oc/echoer", "echo");
    const third = recordStrike("oc/echoer", "echo");
    expect(third.shouldLock).toBe(false);

    const body = { messages: [] };
    expect(injectDisciplineNudge(body, "openai", "oc", "echoer")).toBe(true);
  });

  it("returns false when the model identifier is missing", () => {
    recordStrike("oc/mimo", "doubled-json");
    const body = { messages: [] };
    expect(injectDisciplineNudge(body, "openai", null, null)).toBe(false);
  });
});
