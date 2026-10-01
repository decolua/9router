import { afterEach, describe, expect, it } from "vitest";

import { AzureExecutor, isAzureProbeValid, resolveAzureTarget } from "../../open-sse/executors/azure.js";
import { getTargetFormat } from "../../open-sse/services/provider.js";

// Codex sends function tools together with reasoning_effort. Azure rejects that pair on the
// per-deployment /chat/completions path ("Function tools with reasoning_effort are not supported
// for gpt-6-luna in /v1/chat/completions"), so an azure connection can opt into the resource-level
// v1 Responses API via providerSpecificData.apiType — the same switch openai-compatible nodes use.
describe("azure Responses API route", () => {
  const ENDPOINT = "https://example-resource.openai.azure.com";
  const base = { azureEndpoint: ENDPOINT, deployment: "gpt-6-luna", apiVersion: "2024-10-01-preview" };

  afterEach(() => {
    delete process.env.AZURE_ENDPOINT;
    delete process.env.AZURE_API_VERSION;
    delete process.env.AZURE_DEPLOYMENT;
  });

  describe("resolveAzureTarget", () => {
    it("targets the v1 responses path when apiType is responses", () => {
      const { url, responses } = resolveAzureTarget({ ...base, apiType: "responses" });
      expect(url).toBe(`${ENDPOINT}/openai/v1/responses?api-version=preview`);
      expect(responses).toBe(true);
    });

    // The v1 surface accepts only api-version=preview; a dated version answers
    // 400 "API version not supported", so the stored apiVersion must be ignored there.
    it("ignores the stored apiVersion on the responses path", () => {
      const { url } = resolveAzureTarget({ ...base, apiVersion: "2025-04-01-preview", apiType: "responses" });
      expect(url).not.toContain("2025-04-01-preview");
      expect(url).toContain("api-version=preview");
    });

    it("keeps the per-deployment chat path when apiType is chat or absent", () => {
      const expected = `${ENDPOINT}/openai/deployments/gpt-6-luna/chat/completions?api-version=2024-10-01-preview`;
      expect(resolveAzureTarget({ ...base, apiType: "chat" }).url).toBe(expected);
      expect(resolveAzureTarget(base).url).toBe(expected);
      expect(resolveAzureTarget(base).responses).toBe(false);
    });

    it("falls back to the requested model when no deployment is pinned", () => {
      const { url, deployment } = resolveAzureTarget({ azureEndpoint: ENDPOINT }, "gpt-4o");
      expect(deployment).toBe("gpt-4o");
      expect(url).toContain("/openai/deployments/gpt-4o/chat/completions");
    });

    it("strips a trailing slash from the endpoint", () => {
      const { url } = resolveAzureTarget({ azureEndpoint: `${ENDPOINT}/`, apiType: "responses" });
      expect(url).toBe(`${ENDPOINT}/openai/v1/responses?api-version=preview`);
    });
  });

  describe("AzureExecutor", () => {
    const executor = new AzureExecutor();

    it("buildUrl matches the resolved target in both modes", () => {
      for (const apiType of ["chat", "responses"]) {
        const credentials = { providerSpecificData: { ...base, apiType } };
        expect(executor.buildUrl("gpt-6-luna", true, 0, credentials))
          .toBe(resolveAzureTarget(credentials.providerSpecificData, "gpt-6-luna").url);
      }
    });

    // The deployment moves from the URL into the body on the v1 path, so the same
    // connection resolves to the same deployment whichever apiType it is set to.
    it("rewrites body.model to the deployment on the responses path only", () => {
      const body = { model: "gpt-6-luna", input: [], tools: [] };

      const responsesBody = executor.transformRequest("gpt-6-luna", body, true, {
        providerSpecificData: { ...base, deployment: "my-luna-deploy", apiType: "responses" },
      });
      expect(responsesBody.model).toBe("my-luna-deploy");
      expect(responsesBody.tools).toBe(body.tools);
      expect(body.model).toBe("gpt-6-luna"); // no mutation of the caller's body

      const chatBody = executor.transformRequest("gpt-6-luna", body, true, {
        providerSpecificData: { ...base, deployment: "my-luna-deploy", apiType: "chat" },
      });
      expect(chatBody).toBe(body);
    });
  });

  // Probing the right URL is only half the job: the validate route and the Test button also have
  // to judge the answer. Statuses below are the ones a real resource returned.
  describe("isAzureProbeValid", () => {
    it("accepts successful Responses statuses", () => {
      for (const status of [200, 201, 204]) {
        expect(isAzureProbeValid(status, true)).toBe(true);
      }
    });

    it("rejects unsupported and unknown Responses statuses", () => {
      // 400: unsupported API version; 404: DeploymentNotFound.
      // Redirects, unsupported methods, gone endpoints, invalid payloads, and
      // unimplemented servers do not establish a usable Responses connection.
      for (const status of [302, 400, 404, 405, 410, 422, 501]) {
        expect(isAzureProbeValid(status, true)).toBe(false);
      }
    });

    // A healthy chat deployment answers the max_tokens:1 probe with 400 ("model output limit
    // was reached"), so that branch can only judge auth — tightening it would fail every
    // working azure chat connection.
    it("keeps the chat probe auth-only", () => {
      expect(isAzureProbeValid(400, false)).toBe(true);
      expect(isAzureProbeValid(404, false)).toBe(true);
    });

    it("rejects auth failures in both modes", () => {
      for (const responses of [true, false]) {
        expect(isAzureProbeValid(401, responses)).toBe(false);
        expect(isAzureProbeValid(403, responses)).toBe(false);
      }
    });

    // Timeouts, quota, and ordinary upstream outages do not establish that
    // the connection is misconfigured.
    it("accepts explicitly tolerated transient Responses statuses", () => {
      for (const status of [408, 429, 500, 502, 503, 504]) {
        expect(isAzureProbeValid(status, true)).toBe(true);
      }
    });
  });

  describe("getTargetFormat", () => {
    it("returns openai-responses for an azure connection in responses mode", () => {
      expect(getTargetFormat("azure", { providerSpecificData: { apiType: "responses" } }))
        .toBe("openai-responses");
    });

    it("leaves azure on openai for chat mode and for legacy connections with no apiType", () => {
      expect(getTargetFormat("azure", { providerSpecificData: { apiType: "chat" } })).toBe("openai");
      expect(getTargetFormat("azure", { providerSpecificData: {} })).toBe("openai");
      expect(getTargetFormat("azure")).toBe("openai");
    });

    // Guards the supportsApiTypeSelection predicate: a provider that has not opted in
    // must keep its registry format even if a stray apiType rides along on the connection.
    it("ignores apiType for providers that have not opted in", () => {
      expect(getTargetFormat("anthropic", { providerSpecificData: { apiType: "responses" } }))
        .toBe(getTargetFormat("anthropic"));
      expect(getTargetFormat("openai", { providerSpecificData: { apiType: "responses" } }))
        .toBe("openai");
    });
  });
});
