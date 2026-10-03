import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
}));

let POST;

beforeAll(async () => {
  vi.stubGlobal("fetch", fetchMock);
  ({ POST } = await import("@/app/api/providers/validate/route.js"));
});

afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
});

function request(zdrEnabled) {
  const body = {
    provider: "commandcode",
    apiKey: "test-key",
  };
  if (zdrEnabled !== undefined) body.providerSpecificData = { zdrEnabled };

  return new Request("http://9router.local/api/providers/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Command Code API-key validation", () => {
  it("uses the connection ZDR policy for the validation request", async () => {
    await POST(request(true));
    expect(fetchMock.mock.calls[0][1].headers["x-cmd-zdr"]).toBe("1");

    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await POST(request(false));
    expect(fetchMock.mock.calls[0][1].headers["x-cmd-zdr"]).toBeUndefined();

    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await POST(request());
    expect(fetchMock.mock.calls[0][1].headers["x-cmd-zdr"]).toBeUndefined();
  });

  it("keeps a ZDR-unavailable model distinct from an invalid API key", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 422 }));

    const response = await POST(request(true));

    expect(fetchMock.mock.calls[0][1].headers["x-cmd-zdr"]).toBe("1");
    expect((await response.json()).valid).toBe(true);
  });
});
