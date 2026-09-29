import { beforeEach, describe, expect, it, vi } from "vitest";

// execute() fetches through proxyAwareFetch; capture what it actually sends to AWS.
vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => ({
  ...(await importOriginal()),
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { BedrockExecutor, probeBedrockCredentials } from "../../open-sse/executors/bedrock.js";

const STATIC_CREDS = {
  apiKey: "secret-access-key",
  providerSpecificData: { accessKeyId: "AKIAEXAMPLE", region: "us-east-1" },
};

const awsResponse = (status, { errorType, message } = {}) =>
  new Response(JSON.stringify(message ? { message } : {}), {
    status,
    headers: errorType ? { "x-amzn-errortype": `${errorType}:http://internal.amazon.com/coral/` } : {},
  });

describe("probeBedrockCredentials", () => {
  it("signs a ListFoundationModels GET on the control-plane host and accepts a 200", async () => {
    const fetchFn = vi.fn(async () => awsResponse(200));

    await expect(probeBedrockCredentials(STATIC_CREDS, fetchFn)).resolves.toEqual({ valid: true, error: null });

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://bedrock.us-east-1.amazonaws.com/foundation-models");
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("error");
    expect(init.headers.Authorization).toMatch(/Credential=AKIAEXAMPLE\/\d{8}\/us-east-1\/bedrock\/aws4_request/);
  });

  it("treats AccessDeniedException as valid: the signature was accepted, only listing is not allowed", async () => {
    const fetchFn = vi.fn(async () => awsResponse(403, { errorType: "AccessDeniedException" }));
    await expect(probeBedrockCredentials(STATIC_CREDS, fetchFn)).resolves.toEqual({ valid: true, error: null });
  });

  it("rejects credentials AWS does not recognise, naming the AWS error", async () => {
    const fetchFn = vi.fn(async () =>
      awsResponse(403, { errorType: "UnrecognizedClientException", message: "The security token included in the request is invalid." }),
    );

    const result = await probeBedrockCredentials(STATIC_CREDS, fetchFn);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("UnrecognizedClientException");
    expect(result.error).toContain("security token included in the request is invalid");
  });

  it("reports incomplete static keys without calling AWS", async () => {
    const fetchFn = vi.fn();
    const result = await probeBedrockCredentials({ apiKey: "secret-only", providerSpecificData: {} }, fetchFn);

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/static credentials are incomplete/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("refuses a region that would redirect the signed probe to another host", async () => {
    const fetchFn = vi.fn();
    const result = await probeBedrockCredentials(
      { ...STATIC_CREDS, providerSpecificData: { ...STATIC_CREDS.providerSpecificData, region: "evil.com/x" } },
      fetchFn,
    );

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Invalid AWS region/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("returns a validation error when the AWS control-plane probe stalls", async () => {
    vi.useFakeTimers();
    let markStarted;
    const started = new Promise((resolve) => { markStarted = resolve; });
    const fetchFn = (_url, init) => {
      markStarted();
      if (!init.signal) return Promise.reject(new Error("AWS probe has no timeout signal"));
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      });
    };

    try {
      const pending = probeBedrockCredentials(STATIC_CREDS, fetchFn);
      pending.catch(() => {});
      const result = expect(pending).resolves.toMatchObject({
        valid: false,
        error: expect.stringMatching(/timed out/i),
      });
      await started;
      await vi.advanceTimersByTimeAsync(8000);
      await result;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("BedrockExecutor.execute request-log headers", () => {
  beforeEach(() => {
    proxyAwareFetch.mockReset();
  });

  it("sends real credentials to AWS but returns redacted ones for the request logger", async () => {
    proxyAwareFetch.mockResolvedValue(new Response("{}", { status: 200 }));
    const executor = new BedrockExecutor("bedrock");

    const result = await executor.execute({
      model: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
      body: { messages: [{ role: "user", content: "hi" }], max_tokens: 16 },
      stream: false,
      credentials: {
        apiKey: "secret-access-key",
        providerSpecificData: { accessKeyId: "ASIAEXAMPLE", sessionToken: "FwoGZXsession-token", region: "us-east-1" },
      },
    });

    const sent = proxyAwareFetch.mock.calls[0][1].headers;
    expect(sent["x-amz-security-token"]).toBe("FwoGZXsession-token");
    const signature = sent.Authorization.match(/Signature=([0-9a-f]{64})/)?.[1];
    expect(signature).toBeTruthy();

    const logged = result.headers;
    expect(logged["x-amz-security-token"]).toBe("<redacted>");
    expect(logged.Authorization).toContain("Signature=<redacted>");
    expect(logged.Authorization).not.toContain(signature);
    // The non-secret parts stay, so a SignatureDoesNotMatch can still be debugged from the log.
    expect(logged.Authorization).toContain("Credential=ASIAEXAMPLE/");
    expect(logged.Authorization).toContain("SignedHeaders=");
  });

  it("aborts a request that stalls before response headers", async () => {
    vi.useFakeTimers();
    const executor = new BedrockExecutor("bedrock");
    executor.config = { ...executor.config, timeoutMs: 25 };
    const client = new AbortController();
    let markStarted;
    const started = new Promise((resolve) => { markStarted = resolve; });
    proxyAwareFetch.mockImplementation((...args) => {
      const init = args[1];
      if (!init?.signal) {
        throw new Error("Bedrock fetch was sent without an abort signal");
      }
      markStarted(init.signal);
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      });
    });

    const pending = executor.execute({
      model: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
      body: { messages: [{ role: "user", content: "hi" }], max_tokens: 16 },
      stream: false,
      credentials: STATIC_CREDS,
      signal: client.signal,
    });
    pending.catch(() => {});

    try {
      const sentSignal = await started;
      await vi.advanceTimersByTimeAsync(25);
      expect(sentSignal.aborted).toBe(true);
      await expect(pending).rejects.toThrow(/timeout/i);
    } finally {
      client.abort();
      await pending.catch(() => {});
      vi.useRealTimers();
    }
  });
});
