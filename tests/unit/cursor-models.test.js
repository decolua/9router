import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const connectMock = vi.hoisted(() => vi.fn());
vi.mock("http2", () => ({ default: { connect: connectMock } }));

import {
  clearCursorModelCache,
  expandCursorModelAliases,
  parseCursorAvailableModels,
  parseCursorUsableModels,
  resolveCursorModel,
  resolveCursorModelSelection,
  resolveCursorModels,
} from "../../open-sse/services/cursorModels.js";

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
  return concat(varint((fieldNumber << 3) | 2), varint(value.length), value);
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

function model(id, name) {
  return field(1, concat(field(1, text(id)), field(4, text(name))));
}

function parameter(id, value) {
  return concat(field(1, text(id)), field(2, text(value)));
}

function availableModel({ id, name, serverModelName, legacySlugs = [], variants = [] }) {
  const detail = concat(
    field(1, text(id)),
    field(17, text(name || id)),
    ...(serverModelName ? [field(18, text(serverModelName))] : []),
    ...legacySlugs.map((slug) => field(36, text(slug))),
    ...variants.map((variant) => field(30, concat(
      ...(variant.parameters || []).map((value) => field(1, parameter(value.id, value.value))),
      ...(variant.displayName ? [field(2, text(variant.displayName))] : []),
      ...(variant.isMaxMode ? [field(3, varint(1))] : []),
      ...(variant.variantStringRepresentation ? [field(9, text(variant.variantStringRepresentation))] : []),
      ...(variant.legacySlug ? [field(11, text(variant.legacySlug))] : []),
    ))),
  );
  return field(2, detail);
}

function mockUnaryResponse(payload, status = 200) {
  const handlers = new Map();
  const request = {
    on(event, handler) {
      handlers.set(event, handler);
      return request;
    },
    end() {
      handlers.get("response")?.({ ":status": status });
      if (payload.length) handlers.get("data")?.(Buffer.from(payload));
      handlers.get("end")?.();
    },
  };
  connectMock.mockReturnValue({
    on() {},
    request() { return request; },
    close() {},
  });
}

describe("Cursor live model catalog", () => {
  beforeEach(() => {
    clearCursorModelCache();
    connectMock.mockReset();
  });

  afterEach(() => {
    clearCursorModelCache();
  });

  it("decodes the GetUsableModels protobuf response", () => {
    const payload = concat(
      model("default", "Auto"),
      model("gpt-5.3-codex", "GPT 5.3 Codex"),
      model("gpt-5.3-codex", "Duplicate"),
    );

    expect(parseCursorUsableModels(payload)).toEqual([
      { id: "default", name: "Auto" },
      { id: "gpt-5.3-codex", name: "GPT 5.3 Codex" },
    ]);
  });

  it("decodes canonical model IDs and parameterized variants", () => {
    const payload = availableModel({
      id: "grok-4.5",
      name: "Grok 4.5",
      serverModelName: "grok-4.5",
      variants: [
        {
          variantStringRepresentation: "grok-4.5[effort=high,fast=false]",
          legacySlug: "cursor-grok-4.5-high",
          parameters: [
            { id: "effort", value: "high" },
            { id: "fast", value: "false" },
          ],
        },
        {
          variantStringRepresentation: "grok-4.5[effort=high,fast=true]",
          legacySlug: "cursor-grok-4.5-high-fast",
          parameters: [
            { id: "effort", value: "high" },
            { id: "fast", value: "true" },
          ],
        },
      ],
    });

    const models = parseCursorAvailableModels(payload);
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({ id: "grok-4.5", name: "Grok 4.5" });
    expect(expandCursorModelAliases(models).map((model) => model.id)).toEqual([
      "grok-4.5",
      "cursor-grok-4.5-high",
      "cursor-grok-4.5-high-fast",
    ]);
    expect(resolveCursorModelSelection(models, "cursor-grok-4.5-high")).toMatchObject({
      modelId: "grok-4.5",
      parameters: [
        { id: "effort", value: "high" },
        { id: "fast", value: "false" },
      ],
      matchedBy: "variant-legacy-slug",
    });
    expect(resolveCursorModelSelection(models, "cursor-grok-4.5-high-fast")).toMatchObject({
      modelId: "grok-4.5",
      parameters: [
        { id: "effort", value: "high" },
        { id: "fast", value: "true" },
      ],
      matchedBy: "variant-legacy-slug",
    });
  });

  it("fetches the account-specific catalog and caches it", async () => {
    const payload = availableModel({ id: "claude-4.6-opus", name: "Claude 4.6 Opus" });
    mockUnaryResponse(payload);
    const credentials = {
      accessToken: "cursor-token",
      providerSpecificData: { machineId: "machine-id" },
    };

    await expect(resolveCursorModels(credentials)).resolves.toEqual({
      models: [{
        id: "claude-4.6-opus",
        name: "Claude 4.6 Opus",
        serverModelName: "",
        legacySlugs: [],
        idAliases: [],
        variants: [],
      }],
    });
    await expect(resolveCursorModels(credentials)).resolves.toEqual({
      models: [{
        id: "claude-4.6-opus",
        name: "Claude 4.6 Opus",
        serverModelName: "",
        legacySlugs: [],
        idAliases: [],
        variants: [],
      }],
    });

    expect(connectMock).toHaveBeenCalledTimes(1);
  });

  it("resolves Fast and non-Fast legacy slugs to distinct parameters", async () => {
    mockUnaryResponse(concat(
      availableModel({
        id: "grok-4.5",
        name: "Cursor Grok 4.5",
        variants: [
          {
            legacySlug: "cursor-grok-4.5-high",
            parameters: [
              { id: "effort", value: "high" },
              { id: "fast", value: "false" },
            ],
          },
          {
            legacySlug: "cursor-grok-4.5-high-fast",
            parameters: [
              { id: "effort", value: "high" },
              { id: "fast", value: "true" },
            ],
          },
        ],
      }),
      // Cursor echoes additional_model_names as a synthetic exact entry.
      availableModel({ id: "cursor-grok-4.5-high", name: "cursor-grok-4.5-high" }),
    ));
    const credentials = {
      accessToken: "cursor-token",
      providerSpecificData: { machineId: "machine-id" },
    };

    await expect(resolveCursorModel(credentials, "cursor-grok-4.5-high")).resolves.toMatchObject({
      modelId: "grok-4.5",
      parameters: [{ id: "effort", value: "high" }, { id: "fast", value: "false" }],
    });
    await expect(resolveCursorModel(credentials, "cursor-grok-4.5-high-fast")).resolves.toMatchObject({
      modelId: "grok-4.5",
      parameters: [{ id: "effort", value: "high" }, { id: "fast", value: "true" }],
    });
    expect(connectMock).toHaveBeenCalledTimes(1);
  });

  it("fails open when the Cursor catalog request fails", async () => {
    mockUnaryResponse(new Uint8Array(), 403);

    await expect(resolveCursorModels({
      accessToken: "cursor-token",
      providerSpecificData: { machineId: "machine-id" },
    })).resolves.toBeNull();
  });
});
