// Regression: custom providers (openai-/anthropic-compatible, custom embedding)
// are addressed by the Prefix the user configured ("mirai"), not by the node's
// internal id ("openai-compatible-chat-<uuid>"). The dashboard published the
// node id, so every model id the user copied into a client was unusable.
//
// See decolua/9router#5763.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolveProviderPrefix } from "@/shared/utils/providerPrefix.js";
import { buildModelGroups, collectModelValues } from "@/shared/utils/selectableModels.js";

const NODE_ID = "openai-compatible-chat-330c58ab-a28a-46ed-9baa-0e1c8510562c";
const PREFIX = "mirai";
const MODEL = "deepseek-v4-flash";

const node = { id: NODE_ID, type: "openai-compatible", name: "MiraiAPI", prefix: PREFIX, apiType: "chat", baseUrl: "https://api.miraiapi.com/v1" };
const connection = {
  id: "conn-1",
  provider: NODE_ID,
  isActive: true,
  name: "MiraiAPI",
  providerSpecificData: { prefix: PREFIX, apiType: "chat", baseUrl: node.baseUrl, nodeName: "MiraiAPI" },
};

describe("resolveProviderPrefix", () => {
  it("prefers the prefix stored on the connection", () => {
    expect(resolveProviderPrefix({
      providerId: NODE_ID,
      providerSpecificData: connection.providerSpecificData,
      node,
    })).toBe(PREFIX);
  });

  it("falls back to the provider node's prefix", () => {
    expect(resolveProviderPrefix({ providerId: NODE_ID, node })).toBe(PREFIX);
  });

  it("falls back to the registry alias for built-in providers", () => {
    expect(resolveProviderPrefix({ providerId: "openai" })).toBe("openai");
    expect(resolveProviderPrefix({ providerId: "codex" })).toBe("cx");
  });

  it("falls back to the provider id when nothing else is configured", () => {
    expect(resolveProviderPrefix({ providerId: NODE_ID })).toBe(NODE_ID);
  });

  it("ignores blank prefixes", () => {
    expect(resolveProviderPrefix({ providerId: NODE_ID, providerSpecificData: { prefix: "  " } })).toBe(NODE_ID);
    expect(resolveProviderPrefix({ providerId: NODE_ID, node: { prefix: "" } })).toBe(NODE_ID);
  });
});

describe("model picker publishes the prefix, not the node id", () => {
  it("lists custom-provider models under the configured prefix", () => {
    const groups = buildModelGroups({
      connections: [connection],
      allConnections: [connection],
      modelAliases: {},
      customModels: [{ providerAlias: NODE_ID, id: MODEL, type: "llm", name: MODEL }],
      disabledModels: {},
      providerNodes: [node],
    });

    const values = collectModelValues(groups);
    expect(values).toContain(`${PREFIX}/${MODEL}`);
    expect(values).not.toContain(`${NODE_ID}/${MODEL}`);
  });

  it("keeps user aliases on the prefix form too", () => {
    const groups = buildModelGroups({
      connections: [connection],
      allConnections: [connection],
      modelAliases: { "my-alias": `${NODE_ID}/${MODEL}` },
      customModels: [],
      disabledModels: {},
      providerNodes: [node],
    });

    const values = collectModelValues(groups);
    expect(values).toContain(`${PREFIX}/${MODEL}`);
    expect(values).not.toContain(`${NODE_ID}/${MODEL}`);
  });

  it("publishes the placeholder under the prefix as well", () => {
    const groups = buildModelGroups({
      connections: [connection],
      allConnections: [connection],
      modelAliases: {},
      customModels: [],
      disabledModels: {},
      providerNodes: [node],
    });

    const values = collectModelValues(groups);
    expect(values).toContain(`${PREFIX}/model-id`);
    expect(values).not.toContain(`${NODE_ID}/model-id`);
  });
});

describe("/api/models publishes the prefix, not the node id", () => {
  let tempDir = "";
  const originalDataDir = process.env.DATA_DIR;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-models-prefix-"));
    process.env.DATA_DIR = tempDir;
    vi.resetModules();
    vi.doMock("next/server", () => ({
      NextResponse: {
        json: (body, init = {}) => new Response(JSON.stringify(body), {
          status: init.status || 200,
          headers: { "Content-Type": "application/json" },
        }),
      },
    }));
  });

  afterEach(() => {
    vi.doUnmock("next/server");
    vi.resetModules();
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("lists a custom node's models under the configured prefix", async () => {
    const { createProviderNode, createProviderConnection, addCustomModel } = await import("@/models/index.js");
    await createProviderNode(node);
    await createProviderConnection({
      provider: NODE_ID,
      authType: "apikey",
      name: "MiraiAPI",
      apiKey: "test-key",
      providerSpecificData: connection.providerSpecificData,
      isActive: true,
    });
    await addCustomModel({ providerAlias: NODE_ID, id: MODEL, type: "llm", name: MODEL });

    const { GET } = await import("@/app/api/models/route.js");
    const body = await (await GET()).json();
    const ids = body.models.map((m) => m.fullModel);

    expect(ids).toContain(`${PREFIX}/${MODEL}`);
    expect(ids).not.toContain(`${NODE_ID}/${MODEL}`);
  });

  it("leaves built-in providers on their registry alias", async () => {
    const { createProviderConnection } = await import("@/models/index.js");
    // A stray `prefix` on a built-in connection must not remap its models.
    await createProviderConnection({
      provider: "openai",
      authType: "apikey",
      name: "OpenAI",
      apiKey: "test-key",
      providerSpecificData: { prefix: "not-the-alias" },
      isActive: true,
    });

    const { GET } = await import("@/app/api/models/route.js");
    const body = await (await GET()).json();
    const ids = body.models.map((m) => m.routedModel);

    expect(ids.some((id) => id.startsWith("openai/"))).toBe(true);
    expect(ids.some((id) => id.startsWith("not-the-alias/"))).toBe(false);
  });
});

describe("routing resolves both the prefix and the node id", () => {
  let tempDir = "";
  const originalDataDir = process.env.DATA_DIR;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-route-prefix-"));
    process.env.DATA_DIR = tempDir;
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("routes mirai/model and <node-id>/model to the same provider", async () => {
    const { createProviderNode } = await import("@/models/index.js");
    await createProviderNode(node);

    const { getModelInfo } = await import("@/sse/services/model.js");
    const expected = { provider: NODE_ID, model: MODEL };

    expect(await getModelInfo(`${PREFIX}/${MODEL}`)).toEqual(expected);
    expect(await getModelInfo(`${NODE_ID}/${MODEL}`)).toEqual(expected);
  });
});
