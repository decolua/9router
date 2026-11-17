import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let dataDir;
let GET;
let createProviderConnection;

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-antigravity-models-"));
  process.env.DATA_DIR = dataDir;
  vi.resetModules();
  ({ GET } = await import("@/app/api/providers/[id]/models/route.js"));
  ({ createProviderConnection } = await import("@/models/index.js"));
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

it("uses each account's authenticated catalog and removes unavailable/internal models", async () => {
  const fetchMock = vi.fn(async (_url, options) => Response.json({
    models: options.headers.Authorization === "Bearer account-a" ? {
      "gemini-live": { displayName: "Gemini Live", maxTokens: 1000000, maxOutputTokens: 64000, supportsImages: true, supportsThinking: true },
      "argon-disabled": {},
      "carbon-disabled-preview": {},
      "tab_completion": {},
      "internal-model": { isInternal: true },
    } : { "account-b-only": {} },
  }));
  vi.stubGlobal("fetch", fetchMock);
  const results = [];
  for (const account of ["a", "b"]) {
    const connection = await createProviderConnection({
      provider: "antigravity",
      authType: "oauth",
      accessToken: `account-${account}`,
      email: `${account}@example.com`,
      testStatus: "active",
    });
    const response = await GET(new Request(`http://localhost/api/providers/${connection.id}/models`), {
      params: Promise.resolve({ id: connection.id }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.connectionId).toBe(connection.id);
    results.push(body.models);
  }
  expect(results).toEqual([
    [{ id: "gemini-live", name: "Gemini Live", contextLength: 1000000, maxOutputTokens: 64000, isVL: true, isReasoning: true }],
    [{ id: "account-b-only", name: "account-b-only", isVL: false, isReasoning: false }],
  ]);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock).toHaveBeenCalledWith(
    "https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
    expect.objectContaining({ method: "POST", body: "{}", headers: expect.objectContaining({
      "User-Agent": "antigravity/hub/2.24.0 darwin/arm64",
      "X-Client-Name": "antigravity",
      "X-Client-Version": "2.24.0",
    }) }),
  );
});

