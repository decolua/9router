import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
const SESSION_TOKEN = "FwoGZX-saved-session-token";

let tempDir;
let listConnections;
let createConnection;
let getConnection;
let updateConnection;
let getStoredConnection;

function request(method, url, body) {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createAwsConnection(provider) {
  const response = await createConnection(request("POST", "https://9router.local/api/providers", {
    provider,
    name: `${provider} test connection`,
    apiKey: "secret-access-key",
    providerSpecificData: {
      accessKeyId: "ASIAEXAMPLE",
      sessionToken: SESSION_TOKEN,
      region: "us-east-1",
    },
  }));
  expect(response.status).toBe(201);
  return { response, body: await response.json() };
}

describe("Bedrock connection API secrets", () => {
  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-bedrock-api-secrets-"));
    process.env.DATA_DIR = tempDir;
    delete global._dbAdapter;
    vi.resetModules();
    vi.doMock("next/server", () => ({
      NextResponse: {
        json(body, init = {}) {
          return new Response(JSON.stringify(body), {
            status: init.status || 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      },
    }));

    ({ GET: listConnections, POST: createConnection } = await import("@/app/api/providers/route.js"));
    ({ GET: getConnection, PUT: updateConnection } = await import("@/app/api/providers/[id]/route.js"));
    ({ getProviderConnectionById: getStoredConnection } = await import("@/models/index.js"));
  });

  afterEach(() => {
    vi.doUnmock("next/server");
    vi.resetModules();
    global._dbAdapter?.instance?.close?.();
    delete global._dbAdapter;
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it.each(["bedrock", "bedrock-xai"])(
    "does not return a %s session token from create, list, detail, or update",
    async (provider) => {
      const created = await createAwsConnection(provider);
      const id = created.body.connection.id;
      const stored = await getStoredConnection(id);
      expect(stored.providerSpecificData.sessionToken).toBe(SESSION_TOKEN);

      const listed = await listConnections();
      const detail = await getConnection(
        new Request(`https://9router.local/api/providers/${id}`),
        { params: Promise.resolve({ id }) },
      );
      const updated = await updateConnection(
        request("PUT", `https://9router.local/api/providers/${id}`, { name: "Renamed connection" }),
        { params: Promise.resolve({ id }) },
      );

      for (const responseBody of [
        created.body,
        await listed.json(),
        await detail.json(),
        await updated.json(),
      ]) {
        expect(JSON.stringify(responseBody)).not.toContain(SESSION_TOKEN);
      }
    },
  );

  it("keeps a saved AWS session token when an edit sends an empty token field", async () => {
    const created = await createAwsConnection("bedrock");
    const id = created.body.connection.id;

    const updated = await updateConnection(
      request("PUT", `https://9router.local/api/providers/${id}`, {
        providerSpecificData: {
          region: "us-west-2",
          sessionToken: "",
        },
      }),
      { params: Promise.resolve({ id }) },
    );

    expect(updated.status).toBe(200);
    const stored = await getStoredConnection(id);
    expect(stored.providerSpecificData.region).toBe("us-west-2");
    expect(stored.providerSpecificData.sessionToken).toBe(SESSION_TOKEN);
  });

  it("removes a saved AWS session token only when the edit explicitly clears it", async () => {
    const created = await createAwsConnection("bedrock");
    const id = created.body.connection.id;

    const updated = await updateConnection(
      request("PUT", `https://9router.local/api/providers/${id}`, {
        providerSpecificData: { sessionToken: null },
      }),
      { params: Promise.resolve({ id }) },
    );

    expect(updated.status).toBe(200);
    const stored = await getStoredConnection(id);
    expect(stored.providerSpecificData).not.toHaveProperty("sessionToken");
  });
});
