import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  modalitiesFromModelEntry,
  getNodeReportedModalities,
  withNodeModalities,
  _resetNodeModalitiesCache,
} from "../../open-sse/providers/nodeModalities.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { stripUnsupportedModalities } from "../../open-sse/translator/concerns/modality.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const P = "openai-compatible-chat-11111111-2222-3333-4444-555555555555";
const CREDS = { apiKey: "k", providerSpecificData: { baseUrl: "http://node.local/v1/" } };
const MLX_SERVE = { data: [{ id: "mlx-community/Inkling-2-Mini-4bit", capabilities: ["chat", "tool_use", "vision"], input_modalities: ["text", "image"] }, { id: "text-only", input_modalities: ["text"] }] };
const okJson = (body) => vi.fn(async () => ({ ok: true, json: async () => body }));

describe("modalitiesFromModelEntry", () => {
  it("reads the shapes nodes use", () => {
    expect(modalitiesFromModelEntry({ input_modalities: ["text", "image"] })).toEqual({ vision: true });
    expect(modalitiesFromModelEntry({ architecture: { input_modalities: ["text", "image", "audio", "file"] } })).toEqual({ vision: true, audioInput: true, pdf: true });
    expect(modalitiesFromModelEntry({ modalities: { input: ["text", "pdf"] } })).toEqual({ pdf: true });
    expect(modalitiesFromModelEntry({ capabilities: ["completion", "vision"] })).toEqual({ vision: true });
  });
  it("reads LM Studio's native type", () => {
    expect(modalitiesFromModelEntry({ id: "qwen2.5-vl-7b", type: "vlm" })).toEqual({ vision: true });
    expect(modalitiesFromModelEntry({ id: "llama", type: "llm" })).toBeNull();
  });
  it("returns null when nothing is declared", () => {
    expect(modalitiesFromModelEntry({ id: "x" })).toBeNull();
    expect(modalitiesFromModelEntry(null)).toBeNull();
  });
});

describe("getNodeReportedModalities", () => {
  beforeEach(() => _resetNodeModalitiesCache());

  it("reads the node's /models with its key and caches per node", async () => {
    const f = okJson(MLX_SERVE);
    expect(await getNodeReportedModalities(P, "mlx-community/Inkling-2-Mini-4bit", CREDS, f)).toEqual({ vision: true });
    expect(await getNodeReportedModalities(P, "text-only", CREDS, f)).toEqual({});
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe("http://node.local/v1/models");
    expect(f.mock.calls[0][1].headers.authorization).toBe("Bearer k");
  });

  it("ignores built-in providers and nodes without a base URL", async () => {
    const f = okJson(MLX_SERVE);
    expect(await getNodeReportedModalities("openai", "gpt-x", CREDS, f)).toBeNull();
    expect(await getNodeReportedModalities(P, "m", {}, f)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("an unreachable node yields null and is not retried within the TTL", async () => {
    const f = vi.fn(async () => { throw new Error("ECONNREFUSED"); });
    expect(await getNodeReportedModalities(P, "m", CREDS, f)).toBeNull();
    const calls = f.mock.calls.length;
    expect(await getNodeReportedModalities(P, "m", CREDS, f)).toBeNull();
    expect(f.mock.calls.length).toBe(calls);
  });
});

describe("servers whose /models carries no modalities", () => {
  beforeEach(() => _resetNodeModalitiesCache());
  const route = (map) => vi.fn(async (url, init) => {
    const body = map[url];
    if (typeof body === "function") return { ok: true, json: async () => body(init) };
    return body ? { ok: true, json: async () => body } : { ok: false, json: async () => ({}) };
  });

  it("LM Studio: falls back to /api/v0/models on the same host", async () => {
    const f = route({
      "http://lms:1234/v1/models": { data: [{ id: "qwen2.5-vl-7b" }] },
      "http://lms:1234/api/v0/models": { data: [{ id: "qwen2.5-vl-7b", type: "vlm" }] },
    });
    const creds = { providerSpecificData: { baseUrl: "http://lms:1234/v1" } };
    expect(await getNodeReportedModalities(P, "qwen2.5-vl-7b", creds, f)).toEqual({ vision: true });
  });

  it("Ollama: asks /api/show for the model", async () => {
    const f = route({
      "http://ollama:11434/v1/models": { data: [{ id: "gemma3:12b" }] },
      "http://ollama:11434/api/show": (init) => (JSON.parse(init.body).model === "gemma3:12b" ? { capabilities: ["completion", "vision"] } : {}),
    });
    const creds = { providerSpecificData: { baseUrl: "http://ollama:11434/v1" } };
    expect(await getNodeReportedModalities(P, "gemma3:12b", creds, f)).toEqual({ vision: true });
    expect(await getNodeReportedModalities(P, "gemma3:12b", creds, f)).toEqual({ vision: true });
    expect(f.mock.calls.filter(([u]) => u.endsWith("/api/show"))).toHaveLength(1);
  });

  it("anthropic-compatible nodes send x-api-key", async () => {
    const f = okJson({ data: [{ id: "m", input_modalities: ["text", "image"] }] });
    const A = "anthropic-compatible-11111111-2222-3333-4444-555555555555";
    expect(await getNodeReportedModalities(A, "m", CREDS, f)).toEqual({ vision: true });
    expect(f.mock.calls[0][1].headers["x-api-key"]).toBe("k");
  });
});

describe("end to end with the strip step", () => {
  beforeEach(() => _resetNodeModalitiesCache());

  it("keeps the image for a node model that reports image input", async () => {
    const model = "mlx-community/Inkling-2-Mini-4bit";
    const base = getCapabilitiesForModel(P, model);
    expect(base.vision).toBe(false); // unknown to every table: the bug
    const caps = withNodeModalities(base, await getNodeReportedModalities(P, model, CREDS, okJson(MLX_SERVE)));
    const body = { messages: [{ role: "user", content: [{ type: "text", text: "read" }, { type: "image_url", image_url: { url: "data:image/png;base64,xx" } }] }] };
    stripUnsupportedModalities(body, FORMATS.OPENAI, caps);
    expect(body.messages[0].content.map((b) => b.type)).toEqual(["text", "image_url"]);
  });

  it("still strips for a node model that reports text only", async () => {
    const caps = withNodeModalities(getCapabilitiesForModel(P, "text-only"), await getNodeReportedModalities(P, "text-only", CREDS, okJson(MLX_SERVE)));
    const body = { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,xx" } }] }] };
    stripUnsupportedModalities(body, FORMATS.OPENAI, caps);
    expect(body.messages[0].content.some((b) => b.type === "image_url")).toBe(false);
  });

  it("never turns a declared capability off", () => {
    expect(withNodeModalities({ vision: true, pdf: false }, {})).toEqual({ vision: true, pdf: false });
  });
});
