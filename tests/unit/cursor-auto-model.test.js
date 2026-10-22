import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/services/cursorModels.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    // Executor tests stub the network-dependent live fetch; resolver logic
    // itself is exercised against the real module below.
    resolveCursorModels: vi.fn(),
  };
});

import { parseCursorUsableModels, parseCursorAvailableModels, resolveAutoModelSelection, mergeCursorModelFlags } from "../../open-sse/services/cursorModels.js";
import { resolveCursorModels } from "../../open-sse/services/cursorModels.js";
import { CursorExecutor } from "../../open-sse/executors/cursor.js";
import { decodeMessage, encodeField, wrapConnectRPCFrame } from "../../open-sse/utils/cursorProtobuf.js";

const LEN = 2;

function varint(value) {
  const bytes = [];
  while (value >= 0x80) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value);
  return Uint8Array.from(bytes);
}

function field(fieldNumber, value) {
  return Uint8Array.from([(fieldNumber << 3) | 2, ...varint(value.length), ...value]);
}

// Proto bools are varint fields (wire type 0), not length-delimited.
// Tags themselves are varints, so field numbers > 15 need 2 tag bytes.
function boolField(fieldNumber, value) {
  return Uint8Array.from([...varint((fieldNumber << 3) | 0), value ? 1 : 0]);
}

function text(value) {
  return new TextEncoder().encode(value);
}

function concat(...parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

// GetUsableModelsResponse.usable_models (1) → ModelDetails {id(1), name(4)}.
function usableModel(id, name) {
  return field(1, concat(field(1, text(id)), field(4, text(name))));
}

// GetUsableModelsResponse.available_models (2) → AvailableModels
// {name(1), defaultOn(2), isChatOnly(4), supportsAgent(5), isHidden(35)}.
function availableModel({ id, defaultOn = false, isChatOnly = false, supportsAgent = false, isHidden = false }) {
  const parts = [field(1, text(id))];
  if (defaultOn) parts.push(boolField(2, true));
  if (isChatOnly) parts.push(boolField(4, true));
  if (supportsAgent) parts.push(boolField(5, true));
  if (isHidden) parts.push(boolField(35, true));
  return field(2, concat(...parts));
}

const credentials = {
  accessToken: "test-token",
  providerSpecificData: { machineId: "a".repeat(64) },
};

function stubAgentSession(executor, frames) {
  const written = [];
  const queue = [...frames];
  executor.openAgentHttp2Stream = () => ({
    responseHeaders: Promise.resolve({ ":status": 200 }),
    write: (frame) => written.push(Buffer.from(frame)),
    end() {},
    close() {},
    async read() {
      if (!queue.length) return { value: undefined, done: true };
      return { value: queue.shift(), done: false };
    },
  });
  return written;
}

describe("parseCursorAvailableModels", () => {
  it("decodes picker flags from response field 2", () => {
    const payload = concat(
      availableModel({ id: "claude-4.6-opus", defaultOn: true, supportsAgent: true }),
      availableModel({ id: "claude-4.5-haiku", isChatOnly: true }),
      availableModel({ id: "internal-experimental", supportsAgent: true, isHidden: true }),
    );
    expect(parseCursorAvailableModels(payload)).toEqual([
      { id: "claude-4.6-opus", defaultOn: true, isChatOnly: false, supportsAgent: true, isHidden: false },
      { id: "claude-4.5-haiku", defaultOn: false, isChatOnly: true, supportsAgent: false, isHidden: false },
      { id: "internal-experimental", defaultOn: false, isChatOnly: false, supportsAgent: true, isHidden: true },
    ]);
  });

  it("returns no models when the server omits field 2", () => {
    expect(parseCursorAvailableModels(concat(usableModel("gpt-5.2", "GPT")))).toEqual([]);
  });
});

describe("resolveAutoModelSelection", () => {
  it("prefers the account's defaultOn agent model", () => {
    const selection = resolveAutoModelSelection([
      { id: "gpt-5.2", supportsAgent: true },
      { id: "claude-4.6-opus", supportsAgent: true, defaultOn: true },
    ]);
    expect(selection).toEqual({ modelId: "claude-4.6-opus", matchedBy: "auto-default" });
  });

  it("skips chat-only and hidden models", () => {
    const selection = resolveAutoModelSelection([
      { id: "haiku", supportsAgent: true, isChatOnly: true, defaultOn: true },
      { id: "experiment", supportsAgent: true, isHidden: true },
      { id: "composer", supportsAgent: false, defaultOn: true },
      { id: "gpt-5.2", supportsAgent: true },
    ]);
    expect(selection.modelId).toBe("gpt-5.2");
  });

  it("returns null when no agent-capable model exists", () => {
    expect(resolveAutoModelSelection([{ id: "haiku", isChatOnly: true }])).toBeNull();
    expect(resolveAutoModelSelection([])).toBeNull();
    expect(resolveAutoModelSelection(null)).toBeNull();
  });
});

describe("mergeCursorModelFlags", () => {
  it("attaches picker flags to the usable-models list by id", () => {
    const usable = parseCursorUsableModels(concat(usableModel("gpt-5.2", "GPT"), usableModel("haiku", "Haiku")));
    const payload = concat(
      usableModel("gpt-5.2", "GPT"),
      availableModel({ id: "gpt-5.2", supportsAgent: true, defaultOn: true }),
      availableModel({ id: "haiku", isChatOnly: true }),
    );
    expect(mergeCursorModelFlags(usable, payload)).toEqual([
      { id: "gpt-5.2", name: "GPT", defaultOn: true, isChatOnly: false, supportsAgent: true, isHidden: false },
      { id: "haiku", name: "Haiku", defaultOn: false, isChatOnly: true, supportsAgent: false, isHidden: false },
    ]);
    // Without field 2 the list passes through unchanged.
    expect(mergeCursorModelFlags(usable, concat(usableModel("gpt-5.2", "GPT")))).toEqual(usable);
  });
});

describe("CursorExecutor auto model resolution", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("resolves default to the account's defaultOn agent model in the Run frame", async () => {
    resolveCursorModels.mockResolvedValue({
      models: [
        { id: "gpt-5.2", name: "GPT" },
        { id: "claude-4.6-opus", name: "Claude 4.6 Opus", supportsAgent: true, defaultOn: true },
      ],
    });
    const executor = new CursorExecutor();
    const written = stubAgentSession(executor, []);
    await executor.executeAgent({
      model: "default",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials,
    });

    const run = decodeMessage(decodeMessage(written[0].subarray(5)).get(1)[0].value);
    const requested = decodeMessage(run.get(9)[0].value);
    expect(Buffer.from(requested.get(1)[0].value).toString()).toBe("claude-4.6-opus");
    // ModelDetails (field 3) carries the resolved id too.
    const details = decodeMessage(run.get(3)[0].value);
    expect(Buffer.from(details.get(1)[0].value).toString()).toBe("claude-4.6-opus");
  });

  it("fails open with the literal id when the live catalog is unavailable", async () => {
    resolveCursorModels.mockResolvedValue(null);
    const executor = new CursorExecutor();
    const written = stubAgentSession(executor, []);
    await executor.executeAgent({
      model: "default",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials,
    });

    const run = decodeMessage(decodeMessage(written[0].subarray(5)).get(1)[0].value);
    const requested = decodeMessage(run.get(9)[0].value);
    expect(Buffer.from(requested.get(1)[0].value).toString()).toBe("default");
  });

  it("leaves concrete model ids untouched", async () => {
    resolveCursorModels.mockResolvedValue({ models: [{ id: "claude-4.6-opus", defaultOn: true, supportsAgent: true }] });
    const executor = new CursorExecutor();
    const written = stubAgentSession(executor, []);
    await executor.executeAgent({
      model: "gpt-5.2",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials,
    });

    const run = decodeMessage(decodeMessage(written[0].subarray(5)).get(1)[0].value);
    const requested = decodeMessage(run.get(9)[0].value);
    expect(Buffer.from(requested.get(1)[0].value).toString()).toBe("gpt-5.2");
    expect(resolveCursorModels).not.toHaveBeenCalled();
  });
});
