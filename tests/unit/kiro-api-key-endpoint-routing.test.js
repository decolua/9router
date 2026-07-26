import { describe, expect, it } from "vitest";
import { KiroExecutor } from "../../open-sse/executors/kiro.js";

const RUNTIME = "https://runtime.us-east-1.kiro.dev/generateAssistantResponse";
const CODEWHISPERER = "https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse";
const Q = "https://q.us-east-1.amazonaws.com/generateAssistantResponse";

function credentials(authMethod, region = "us-east-1") {
  return { providerSpecificData: { authMethod, region } };
}

describe("Kiro auth-aware endpoint routing", () => {
  const executor = new KiroExecutor();

  it("routes API-key inference through Amazon Q before other surfaces", () => {
    expect(executor.getOrderedBaseUrls(credentials("api_key"))).toEqual([
      Q,
      CODEWHISPERER,
      RUNTIME,
    ]);
  });

  it("keeps Builder ID OAuth on the Kiro runtime surface", () => {
    expect(executor.getOrderedBaseUrls(credentials("builder-id"))).toEqual([
      RUNTIME,
      CODEWHISPERER,
      Q,
    ]);
  });

  it("keeps external IdP on CodeWhisperer before Amazon Q", () => {
    expect(executor.getOrderedBaseUrls(credentials("external_idp"))).toEqual([
      CODEWHISPERER,
      Q,
      RUNTIME,
    ]);
  });

  it("regionalizes AWS endpoints for IDC without changing Kiro runtime", () => {
    expect(executor.getOrderedBaseUrls(credentials("idc", "eu-west-1"))).toEqual([
      "https://codewhisperer.eu-west-1.amazonaws.com/generateAssistantResponse",
      "https://q.eu-west-1.amazonaws.com/generateAssistantResponse",
      RUNTIME,
    ]);
  });

  it("retries only endpoint/auth-surface failures, not payload-invalid 400s", () => {
    expect(executor.shouldRetry(400, 0)).toBe(false);
    expect(executor.shouldRetry(401, 1)).toBe(true);
    expect(executor.shouldRetry(403, 2)).toBe(false);
    expect(executor.shouldRetry(422, 0)).toBe(false);
  });

  it("builds endpoint-specific headers", () => {
    const auth = { accessToken: "test-key", providerSpecificData: { authMethod: "api_key" } };
    const qHeaders = executor.buildHeaders(auth, true, Q);
    const codeWhispererHeaders = executor.buildHeaders(auth, true, CODEWHISPERER);
    const runtimeHeaders = executor.buildHeaders(auth, true, RUNTIME);

    expect(qHeaders.TokenType).toBe("API_KEY");
    expect(qHeaders["X-Amz-Target"]).toBeUndefined();
    expect(codeWhispererHeaders["X-Amz-Target"]).toBe(
      "AmazonCodeWhispererStreamingService.GenerateAssistantResponse"
    );
    expect(runtimeHeaders["X-Amz-Target"]).toBeUndefined();
  });
});
