import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// DF-9ROUTER-63 core fix — serve-time node overlay in getProviderCredentials.
//
// A compatible-node connection snapshots baseUrl/apiType into its
// providerSpecificData at create time. Whatever else keeps snapshots in sync
// (the node PUT propagation block), SERVING must use the node's CURRENT
// values: a node whose baseUrl was corrected must be dialed at the new URL by
// every existing connection with no recreation, even if its stored snapshot
// is stale. The overlay happens inside getProviderCredentials — the one seam
// all request paths (chat/image/embedding/fetch/…) draw credentials through —
// and must fail open to the stored snapshot when the node row is gone.

const originalDataDir = process.env.DATA_DIR;

describe("getProviderCredentials serves the node's current baseUrl (DF-9ROUTER-63)", () => {
  let cleanupDirs = [];

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
    for (const dir of cleanupDirs) fs.rmSync(dir, { recursive: true, force: true });
    cleanupDirs = [];
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  async function setup({ nodeOverrides = {} } = {}) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-creds-overlay-"));
    cleanupDirs.push(tempDir);
    process.env.DATA_DIR = tempDir;

    const {
      createProviderNode,
      createProviderConnection,
      getProviderConnectionById,
      getProviderNodeById,
    } = await import("@/models/index.js");
    const { getProviderCredentials } = await import("@/sse/services/auth.js");

    return {
      createProviderNode,
      createProviderConnection,
      getProviderConnectionById,
      getProviderNodeById,
      getProviderCredentials,
    };
  }

  function makeNode(overrides = {}) {
    return {
      id: "openai-compatible-chat-ovl01",
      type: "openai-compatible",
      name: "Overlay Node",
      prefix: "ovl",
      apiType: "chat",
      baseUrl: "http://127.0.0.1:20128", // wrong url the connection snapshotted
      ...overrides,
    };
  }

  async function createStaleConnection(models) {
    const node = await models.createProviderNode(makeNode());
    const conn = await models.createProviderConnection({
      provider: node.id,
      authType: "apikey",
      name: "stale-key",
      apiKey: "sk-test",
      providerSpecificData: {
        prefix: node.prefix,
        apiType: node.apiType,
        baseUrl: node.baseUrl, // stale snapshot of the wrong url
        nodeName: node.name,
      },
      isActive: true,
    });
    return { node, conn };
  }

  it("serves the node's CURRENT baseUrl even though the stored snapshot is stale", async () => {
    const models = await setup();
    const { node } = await createStaleConnection(models);

    // Node is fixed out-of-band (as PUT /api/provider-nodes/<id> would).
    const { updateProviderNode } = await import("@/models/index.js");
    await updateProviderNode(node.id, { baseUrl: "http://127.0.0.1:20128/v1" });

    const credentials = await models.getProviderCredentials(node.id);

    expect(credentials).toBeTruthy();
    // The stored snapshot in the DB is STILL stale — overlay is serve-time only.
    const stored = await models.getProviderConnectionById((await models.getProviderConnectionById(credentials.connectionId) ? credentials.connectionId : credentials.connectionId));
    expect(stored.providerSpecificData.baseUrl).toBe("http://127.0.0.1:20128");
    // …but the credentials handed to the executor carry the corrected URL.
    expect(credentials.providerSpecificData.baseUrl).toBe("http://127.0.0.1:20128/v1");
  });

  it("overlay covers apiType, prefix and nodeName without clobbering other keys", async () => {
    const models = await setup();
    const { node } = await createStaleConnection(models);

    const { updateProviderNode } = await import("@/models/index.js");
    await updateProviderNode(node.id, {
      baseUrl: "http://127.0.0.1:20128/v1",
      apiType: "responses",
      prefix: "ovl2",
      name: "Overlay Node Renamed",
    });

    const credentials = await models.getProviderCredentials(node.id);
    expect(credentials.providerSpecificData).toMatchObject({
      baseUrl: "http://127.0.0.1:20128/v1",
      apiType: "responses",
      prefix: "ovl2",
      nodeName: "Overlay Node Renamed",
    });
  });

  it("fails open to the stored snapshot when the node row is gone", async () => {
    const models = await setup();
    const { node } = await createStaleConnection(models);
    // Simulate a connection whose node disappeared without a cascade delete.
    await models.getProviderNodeById(node.id);
    const { deleteProviderNode } = await import("@/models/index.js");
    await deleteProviderNode(node.id);

    const credentials = await models.getProviderCredentials(node.id);
    expect(credentials).toBeTruthy();
    expect(credentials.providerSpecificData.baseUrl).toBe("http://127.0.0.1:20128");
  });
});
