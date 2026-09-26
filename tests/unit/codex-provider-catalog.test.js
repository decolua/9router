import { afterEach, expect, it, vi } from "vitest";
const store = vi.hoisted(() => ({ connection: null }));
vi.mock("@/models", () => ({ getProviderConnectionById: async () => store.connection }));
import { GET } from "@/app/api/providers/[id]/models/route.js";

afterEach(() => vi.restoreAllMocks());

it("shows the current account-scoped Codex catalog in the provider dashboard", async () => {
  const conn = store.connection = {
    id: "synthetic-connection",
    provider: "codex", authType: "oauth", accessToken: "codex-test-token",
    testStatus: "active",
    providerSpecificData: { chatgptAccountId: "account-test" },
  };
  const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ models: [
    { slug: "synthetic-alpha", visibility: "list", context_window: 12000, max_context_window: 48000 },
    { slug: "retired-model", visibility: "hide", context_window: 10000 },
  ] }));
  const result = await GET(new Request(`http://localhost/api/providers/${conn.id}/models`), { params: Promise.resolve({ id: conn.id }) });
  const payload = await result.json();
  expect(result.status).toBe(200);
  expect(new URL(fetcher.mock.calls[0][0]).searchParams.get("client_version")).not.toBe("0.144.6");
  expect(fetcher.mock.calls[0][1].headers["ChatGPT-Account-ID"]).toBe("account-test");
  expect(payload.models.map((m) => m.id)).toEqual(["synthetic-alpha", "synthetic-alpha-review"]);
  expect(payload.models[0].capabilities.contextWindow).toBe(12000);
});
