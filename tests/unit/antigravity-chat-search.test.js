import { afterEach, expect, it, vi } from "vitest";
import { handleChatSearch } from "../../open-sse/handlers/search/chatSearch.js";

afterEach(() => vi.unstubAllGlobals());

it("resolves the Antigravity search model like normal inference", async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ response: { candidates: [] } }));
  vi.stubGlobal("fetch", fetchMock);

  const result = await handleChatSearch({
    provider: "antigravity",
    query: "test",
    credentials: { accessToken: "test-token", projectId: "test-project" },
  });

  expect(result.success).toBe(true);
  const [url, request] = fetchMock.mock.calls[0];
  expect(url).toContain("/v1internal:generateContent");
  expect(JSON.parse(request.body)).toMatchObject({
    model: "gemini-3.8-flash-medium",
    requestType: "search",
    request: { tools: [{ googleSearch: {} }] },
  });
});