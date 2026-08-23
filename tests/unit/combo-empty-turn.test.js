// A model that answers with nothing is the one failure the cascade could not see.
// The translator turns an empty upstream turn into a visible `[9router] …` notice,
// so it arrives as a well-formed 200 stream and used to be delivered as the answer —
// which is how a 450-second turn ended in "The stream closed before emitting any
// content" instead of rotating to the next member.
import { describe, it, expect, vi } from "vitest";
import { isEmptyTurnNotice, EMPTY_TURN_PHRASE } from "open-sse/translator/response/emptyTurn.js";
import { handleComboChat } from "open-sse/services/combo.js";

const sse = (text) =>
  new Response(
    `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text } })}\n\n`,
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );

const log = { info() {}, warn() {}, debug() {}, error() {} };

const body = { messages: [{ role: "user", content: "what does this screenshot say?" }] };

describe("isEmptyTurnNotice", () => {
  it("recognises the notice both translators write", () => {
    expect(isEmptyTurnNotice(`[9router] gemini-pro-default ${EMPTY_TURN_PHRASE} (finishReason=STOP).`)).toBe(true);
  });

  it("does not throw away an answer that merely discusses the phrase", () => {
    // Anchored at the start for exactly this reason: the model is explaining the
    // error, not producing one.
    expect(isEmptyTurnNotice(`When a provider ${EMPTY_TURN_PHRASE}, 9router rotates.`)).toBe(false);
  });

  it("is not fooled by an unrelated bracketed opening", () => {
    expect(isEmptyTurnNotice("[note] the build succeeded")).toBe(false);
    expect(isEmptyTurnNotice("")).toBe(false);
  });
});

describe("a combo does not deliver an empty turn", () => {
  it("rotates to the next member instead of returning the notice", async () => {
    const handleSingleModel = vi.fn(async (_body, modelStr) =>
      modelStr === "gemini/gemini-pro-default"
        ? sse(`[9router] gemini-pro-default ${EMPTY_TURN_PHRASE} (finishReason=STOP). The stream closed before emitting any content.`)
        : sse("The screenshot says: Incorrect code."));

    const response = await handleComboChat({
      body,
      models: ["gemini/gemini-pro-default", "kr/claude-sonnet-4.5"],
      handleSingleModel,
      comboName: "Yggdrasil",
      comboStrategy: "fallback",
      log,
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Incorrect code");
    expect(handleSingleModel.mock.calls.map((c) => c[1])).toEqual([
      "gemini/gemini-pro-default",
      "kr/claude-sonnet-4.5",
    ]);
  });

  it("still answers when only the last member has anything to say", async () => {
    const empty = `[9router] x ${EMPTY_TURN_PHRASE} (finishReason=STOP).`;
    const handleSingleModel = vi.fn(async (_body, modelStr) =>
      modelStr === "c/three" ? sse("here it is") : sse(empty));

    const response = await handleComboChat({
      body,
      models: ["a/one", "b/two", "c/three"],
      handleSingleModel,
      comboName: "Yggdrasil",
      comboStrategy: "fallback",
      log,
    });

    expect(await response.text()).toContain("here it is");
    expect(handleSingleModel).toHaveBeenCalledTimes(3);
  });

  it("delivers a real answer untouched, byte for byte", async () => {
    // The hold-back window sits in front of every streamed response. A false
    // positive here would silently re-run a model the operator already paid for.
    const answer = "The screenshot shows the WhatsApp pairing screen.";
    const handleSingleModel = vi.fn(async () => sse(answer));

    const response = await handleComboChat({
      body,
      models: ["a/one", "b/two"],
      handleSingleModel,
      comboName: "Yggdrasil",
      comboStrategy: "fallback",
      log,
    });

    expect(await response.text()).toContain(answer);
    expect(handleSingleModel).toHaveBeenCalledTimes(1);
  });
});
