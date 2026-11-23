import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { handleSttCore } from "open-sse/handlers/sttCore.js";

vi.mock("next/server", () => ({ NextResponse: { json: Response.json } }));
vi.mock("@/models", () => ({ getProviderNodeById: vi.fn() }));
vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({})),
}));
vi.mock("@/lib/network/proxyTest", () => ({ testProxyUrl: vi.fn() }));

const { POST } = await import("../../src/app/api/providers/validate/route.js");
const { testSingleConnection } = await import("../../src/app/api/providers/[id]/test/testUtils.js");
const { getProviderConnectionById } = await import("@/lib/localDb");
const apiKey = "assemblyai-test-key";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  getProviderConnectionById.mockResolvedValue({ provider: "assemblyai", authType: "apikey", apiKey });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function checkNewKey() {
  const response = await POST(new Request("http://localhost/api/providers/validate", {
    method: "POST",
    body: JSON.stringify({ provider: "assemblyai", apiKey }),
  }));
  return response.json();
}

describe.each([
  ["new key", checkNewKey],
  ["saved connection", () => testSingleConnection("assemblyai-connection")],
])("AssemblyAI %s", (_label, run) => {
  it.each([
    [200, true, null],
    [401, false, "Invalid API key"],
    [403, false, "Invalid API key"],
    [429, false, "Unable to verify API key (AssemblyAI returned 429)"],
    [503, false, "Unable to verify API key (AssemblyAI returned 503)"],
  ])("checks credentials with a read-only request and handles HTTP %s", async (status, valid, error) => {
    fetch.mockResolvedValueOnce(new Response(null, { status }));
    expect(await run()).toMatchObject({ valid, error });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("https://api.assemblyai.com/v2/transcript?limit=1");
    expect(options.method ?? "GET").toBe("GET");
    expect(new Headers(options.headers).get("authorization")).toBe(apiKey);
    expect(options.body).toBeUndefined();
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("reports a network error separately from rejected credentials", async () => {
    fetch.mockRejectedValueOnce(new Error("network unavailable"));
    expect(await run()).toMatchObject({ valid: false, error: "network unavailable" });
  });
});

it("uses raw Authorization for AssemblyAI upload, submit and polling", async () => {
  vi.useFakeTimers();
  fetch
    .mockResolvedValueOnce(Response.json({ upload_url: "https://cdn.example/audio" }))
    .mockResolvedValueOnce(Response.json({ id: "transcript-id" }))
    .mockResolvedValueOnce(Response.json({ status: "completed", text: "hello" }));

  const formData = new FormData();
  formData.set("file", new File(["audio"], "sample.wav", { type: "audio/wav" }));
  const transcription = handleSttCore({
    provider: "assemblyai",
    model: "universal-3-pro",
    credentials: { apiKey },
    formData,
    sttConfig: AI_PROVIDERS.assemblyai.sttConfig,
  });
  await vi.advanceTimersByTimeAsync(2000);

  expect((await transcription).success).toBe(true);
  expect(fetch.mock.calls.map(([url, options]) => [url, new Headers(options.headers).get("authorization")])).toEqual([
    ["https://api.assemblyai.com/v2/upload", apiKey],
    ["https://api.assemblyai.com/v2/transcript", apiKey],
    ["https://api.assemblyai.com/v2/transcript/transcript-id", apiKey],
  ]);
});
