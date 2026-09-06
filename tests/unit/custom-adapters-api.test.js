import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GET as listAdapters, POST as createAdapter } from "../../src/app/api/custom-adapters/route.js";
import { GET as getAdapter, PUT as updateAdapter, DELETE as deleteAdapter } from "../../src/app/api/custom-adapters/[id]/route.js";
import { POST as testAdapter } from "../../src/app/api/custom-adapters/test/route.js";
import { deleteCustomAdapter } from "../../src/lib/db/repos/customAdaptersRepo.js";
import * as proxyFetchModule from "../../open-sse/utils/proxyFetch.js";

describe("Custom Adapters API Endpoints", () => {
  let createdAdapterId = null;

  afterEach(async () => {
    if (createdAdapterId) {
      try {
        await deleteCustomAdapter(createdAdapterId);
      } catch {}
      createdAdapterId = null;
    }
  });

  it("creates, retrieves, updates, and deletes a custom adapter via API handlers", async () => {
    // 1. POST /api/custom-adapters
    const createReq = {
      json: async () => ({
        name: "E2E Test Adapter",
        prefix: "e2e-test",
        baseUrl: "https://api.e2e-test.com/v1",
        authType: "apikey",
        headers: { "X-Api-Key": "{{apiKey}}" },
        models: [{ id: "test-m1", name: "Test Model 1" }],
      }),
    };

    const createRes = await createAdapter(createReq);
    expect(createRes.status).toBe(201);
    const createdData = await createRes.json();
    expect(createdData.adapter).toBeDefined();
    expect(createdData.adapter.name).toBe("E2E Test Adapter");
    expect(createdData.adapter.prefix).toBe("e2e-test");
    createdAdapterId = createdData.adapter.id;

    // 2. GET /api/custom-adapters
    const listRes = await listAdapters();
    expect(listRes.status).toBe(200);
    const listData = await listRes.json();
    expect(listData.adapters.some((a) => a.id === createdAdapterId)).toBe(true);

    // 3. GET /api/custom-adapters/[id]
    const getRes = await getAdapter({}, { params: Promise.resolve({ id: createdAdapterId }) });
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    expect(getData.adapter.id).toBe(createdAdapterId);

    // 4. PUT /api/custom-adapters/[id]
    const updateReq = {
      json: async () => ({
        name: "E2E Test Adapter Updated",
        baseUrl: "https://api.e2e-test.com/v2",
      }),
    };
    const updateRes = await updateAdapter(updateReq, { params: Promise.resolve({ id: createdAdapterId }) });
    expect(updateRes.status).toBe(200);
    const updateData = await updateRes.json();
    expect(updateData.adapter.name).toBe("E2E Test Adapter Updated");
    expect(updateData.adapter.baseUrl).toBe("https://api.e2e-test.com/v2");

    // 5. DELETE /api/custom-adapters/[id]
    const deleteRes = await deleteAdapter({}, { params: Promise.resolve({ id: createdAdapterId }) });
    expect(deleteRes.status).toBe(200);
    const deleteData = await deleteRes.json();
    expect(deleteData.success).toBe(true);
    createdAdapterId = null;
  });

  it("POST /api/custom-adapters/test tests transformation and live inference", async () => {
    const spy = vi.spyOn(proxyFetchModule, "proxyAwareFetch").mockResolvedValue(
      new Response(JSON.stringify({ result: "Live test output response" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    try {
      const testReq = {
        json: async () => ({
          adapter: {
            id: "temp-test",
            prefix: "temp-test",
            baseUrl: "https://api.test.com/v1/chat",
            authType: "bearer",
            headers: { Authorization: "Bearer {{apiKey}}" },
            responseMapping: { contentPath: "result" },
          },
          model: "test-m",
          prompt: "Hello testing",
          apiKey: "sk-my-secret-key",
          live: true,
        }),
      };

      const res = await testAdapter(testReq);
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.transformedRequest.url).toBe("https://api.test.com/v1/chat");
      expect(data.transformedRequest.headers.Authorization).toBe("Bearer sk-my-secret-key");
      expect(data.rawResponse.result).toBe("Live test output response");
      expect(data.transformedResponse.choices[0].message.content).toBe("Live test output response");
    } finally {
      spy.mockRestore();
    }
  });
});
