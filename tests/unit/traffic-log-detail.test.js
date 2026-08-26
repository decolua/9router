import { describe, expect, it } from "vitest";
import { __test__ as requestDetails } from "../../src/lib/db/repos/requestDetailsRepo.js";
import { findRequestDetailRow } from "../../src/app/api/usage/logs/[id]/detail/route.js";
import { sanitizeTrafficLogDetail } from "../../src/lib/trafficLogDetail.js";

describe("traffic log response diagnostics", () => {
  it("keeps upstream failure information without persisting request payloads", () => {
    const diagnostic = requestDetails.toResponseDiagnostic({
      id: "detail-1",
      provider: "opencode-go",
      model: "gpt-5.6-luna",
      request: { messages: [{ role: "user", content: "secret" }] },
      providerRequest: { input: [{ role: "user", content: "secret" }] },
      providerResponse: { status: 400, error: "Unsupported parameter" },
      response: { status: 400, error: "Unsupported parameter" },
      status: "error",
    });

    expect(diagnostic.request).toBeNull();
    expect(diagnostic.providerRequest).toBeNull();
    expect(diagnostic.providerResponse).toEqual({ status: 400, error: "Unsupported parameter" });
    expect(diagnostic.diagnosticOnly).toBe(true);
  });

  it("prefers the exact request detail id stored in usage metadata", () => {
    const calls = [];
    const db = {
      get(sql, params) {
        calls.push({ sql, params });
        return params[0] === "detail-exact" ? { data: '{"id":"detail-exact"}' } : null;
      },
    };

    const row = findRequestDetailRow(db, {
      provider: "opencode-go",
      model: "gpt-5.6-luna",
      connectionId: "conn-1",
      timestamp: "2026-08-25T15:01:07.000Z",
    }, { requestDetailId: "detail-exact" });

    expect(row).toEqual({ data: '{"id":"detail-exact"}' });
    expect(calls).toHaveLength(1);
    expect(calls[0].params).toEqual(["detail-exact"]);
  });

  it("falls back to legacy nearest-time lookup when no detail id exists", () => {
    const db = {
      get(_sql, params) {
        return { data: JSON.stringify({ lookup: params }) };
      },
    };
    const log = {
      provider: "opencode-go",
      model: "gpt-5.6-luna",
      connectionId: "conn-1",
      timestamp: "2026-08-25T15:01:07.000Z",
    };

    const row = findRequestDetailRow(db, log, {});
    expect(JSON.parse(row.data).lookup).toEqual([
      "opencode-go",
      "gpt-5.6-luna",
      "conn-1",
      "2026-08-25T15:01:07.000Z",
    ]);
  });

  it("can disable nearest-time fallback for API-key scoped viewers", () => {
    const db = { get: () => { throw new Error("fallback lookup must not run"); } };
    expect(findRequestDetailRow(db, {
      provider: "opencode-go",
      model: "gpt-5.6-luna",
      connectionId: "conn-1",
      timestamp: "2026-08-25T15:01:07.000Z",
    }, {}, { allowLegacyFallback: false })).toBeNull();
  });

  it("returns response diagnostics without request payloads", () => {
    const detail = sanitizeTrafficLogDetail(JSON.stringify({
      id: "detail-1",
      request: { messages: [{ content: "secret" }] },
      providerRequest: { input: "secret" },
      providerResponse: { status: 400, error: "bad request" },
      response: { status: 400 },
      status: "error",
    }));

    expect(detail).toEqual({
      id: "detail-1",
      timestamp: undefined,
      status: "error",
      latency: undefined,
      tokens: undefined,
      providerResponse: { status: 400, error: "bad request" },
      response: { status: 400 },
    });
    expect(detail).not.toHaveProperty("request");
    expect(detail).not.toHaveProperty("providerRequest");
  });
});
