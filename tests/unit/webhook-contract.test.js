/**
 * Contract tests for operational webhooks (task 1).
 *
 * These tests intentionally import modules that do not exist yet:
 *   - src/shared/constants/webhooks.js  (event catalog + bounded limits)
 *   - src/lib/webhooks/validation.js    (pure destination/event validation + safe DTO)
 *
 * RED is expected until the implementation lands. No DB, no network, no globals.
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_WEBHOOK_EVENTS,
  WEBHOOK_DELIVERY_KINDS,
  WEBHOOK_DESTINATION_KINDS,
  WEBHOOK_ERROR_CLASSES,
  WEBHOOK_EVENT_CATALOG,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_FORBIDDEN_HEADER_NAMES,
  WEBHOOK_LIMITS,
  WEBHOOK_SCHEMA_VERSION,
} from "@/shared/constants/webhooks.js";
import {
  checkDestinationCapacity,
  toSafeDestination,
  validateDestinationInput,
  validateEventData,
  validateEventEnvelope,
  validatePayloadSize,
} from "@/lib/webhooks/validation.js";

const DISCORD_URL = "https://discord.com/api/webhooks/1234567890/token-value";
const GENERIC_URL = "https://hooks.example.com/ingest/v1?tenant=acme#frag";

const validCreate = (overrides = {}) => ({
  name: "Ops alerts",
  kind: "discord",
  url: DISCORD_URL,
  enabled: true,
  events: ["request.failed"],
  allowPrivateNetwork: false,
  cooldownSeconds: 300,
  ...overrides,
});

const codesOf = (result) => (result.ok ? [] : result.errors.map((error) => error.code));
const fieldsOf = (result) => (result.ok ? [] : result.errors.map((error) => error.field));

const rawDestination = (overrides = {}) => ({
  id: "wd_1",
  revision: 7,
  name: "Ops alerts",
  kind: "generic",
  url: "https://hooks.example.com/ingest/v1?tenant=acme#frag",
  enabled: true,
  events: ["request.failed"],
  allowPrivateNetwork: false,
  cooldownSeconds: 300,
  signingSecret: "whsec_dummy_signing_secret",
  headers: { Authorization: "Bearer dummy-token", "X-Tenant": "acme" },
  createdAt: "2026-10-18T00:00:00.000Z",
  updatedAt: "2026-10-18T00:00:00.000Z",
  ...overrides,
});

describe("webhook event catalog", () => {
  it("defaults to request.failed only and derives from the catalog", () => {
    const catalogDefaults = WEBHOOK_EVENT_TYPES.filter(
      (type) => WEBHOOK_EVENT_CATALOG[type].defaultSubscribed,
    );

    expect(DEFAULT_WEBHOOK_EVENTS).toEqual(["request.failed"]);
    expect(catalogDefaults).toEqual(DEFAULT_WEBHOOK_EVENTS);
    expect(WEBHOOK_EVENT_CATALOG["request.failed"].severity).toBe("error");
    expect(WEBHOOK_EVENT_CATALOG["account.unavailable"].severity).toBe("warning");
    expect(WEBHOOK_EVENT_CATALOG["token.refresh_failed"].severity).toBe("warning");
    expect(WEBHOOK_EVENT_CATALOG["account.unavailable"].defaultSubscribed).toBe(false);
    expect(WEBHOOK_EVENT_CATALOG["token.refresh_failed"].defaultSubscribed).toBe(false);
    expect(WEBHOOK_EVENT_TYPES).toEqual([
      "request.failed",
      "account.unavailable",
      "token.refresh_failed",
    ]);
  });

  it("does not invent provider.down, quota or budget events", () => {
    expect(WEBHOOK_EVENT_TYPES).not.toContain("provider.down");
    expect(WEBHOOK_EVENT_TYPES.some((type) => /quota|budget|health/i.test(type))).toBe(false);
    expect(WEBHOOK_SCHEMA_VERSION).toBe(1);
  });

  it("locks kinds, internal delivery kinds, error classes and bounded limits", () => {
    expect(WEBHOOK_DESTINATION_KINDS).toEqual(["discord", "slack", "generic"]);
    expect(WEBHOOK_DELIVERY_KINDS).toEqual(["operational", "test"]);
    expect(WEBHOOK_ERROR_CLASSES).toEqual([
      "upstream_http",
      "upstream_network",
      "upstream_timeout",
      "no_credentials",
      "all_unavailable",
      "stream_failed",
      "refresh_failed",
      "internal",
    ]);
    expect(WEBHOOK_LIMITS.maxDestinations).toBe(20);
    expect(WEBHOOK_LIMITS.maxPayloadBytes).toBe(16 * 1024);
    expect(WEBHOOK_LIMITS.cooldownDefaultSeconds).toBe(300);
    expect(WEBHOOK_LIMITS.cooldownMinSeconds).toBe(0);
    expect(WEBHOOK_LIMITS.cooldownMaxSeconds).toBe(3600);
    expect(WEBHOOK_LIMITS.maxHeaders).toBe(8);
    expect(WEBHOOK_LIMITS.headerValueMaxLength).toBe(2048);
    expect(WEBHOOK_LIMITS.urlMaxLength).toBe(2048);
    expect(WEBHOOK_LIMITS.nameMaxLength).toBe(80);
  });
});

describe("validateDestinationInput valid", () => {
  it("accepts a minimal valid destination and applies defaults", () => {
    const result = validateDestinationInput({
      name: "Ops alerts",
      kind: "discord",
      url: DISCORD_URL,
    });

    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({
      name: "Ops alerts",
      kind: "discord",
      enabled: true,
      events: ["request.failed"],
      allowPrivateNetwork: false,
      cooldownSeconds: 300,
    });
  });

  it("accepts all three kinds with valid urls", () => {
    for (const kind of ["discord", "slack", "generic"]) {
      const result = validateDestinationInput(
        validCreate({
          kind,
          url: kind === "generic" ? "https://hooks.example.com/ingest" : DISCORD_URL,
        }),
      );

      expect(result.ok, `kind ${kind}`).toBe(true);
      expect(result.value.kind).toBe(kind);
    }
  });

  it("accepts cooldown boundary values 0 and 3600", () => {
    for (const cooldownSeconds of [0, 3600]) {
      const result = validateDestinationInput(validCreate({ cooldownSeconds }));

      expect(result.ok, `cooldown ${cooldownSeconds}`).toBe(true);
      expect(result.value.cooldownSeconds).toBe(cooldownSeconds);
    }
  });

  it("accepts forward-compatible https urls with query and path", () => {
    const result = validateDestinationInput(
      validCreate({ kind: "generic", url: "https://hooks.example.com:8443/ingest/v1?tenant=acme" }),
    );

    expect(result.ok).toBe(true);
    expect(result.value.url).toBe("https://hooks.example.com:8443/ingest/v1?tenant=acme");
  });

  it("accepts generic authorization and x-* headers", () => {
    const result = validateDestinationInput(
      validCreate({
        kind: "generic",
        url: "https://hooks.example.com/ingest",
        headers: { Authorization: "Bearer dummy", "X-Tenant": "acme" },
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.value.headers).toEqual({
      Authorization: "Bearer dummy",
      "X-Tenant": "acme",
    });
  });

  it("accepts private network opt-in only as a boolean", () => {
    const result = validateDestinationInput(validCreate({ allowPrivateNetwork: true }));

    expect(result.ok).toBe(true);
    expect(result.value.allowPrivateNetwork).toBe(true);
  });

  it("accepts the opt-in transient events as a unique subset", () => {
    const result = validateDestinationInput(
      validCreate({ events: ["request.failed", "account.unavailable", "token.refresh_failed"] }),
    );

    expect(result.ok).toBe(true);
    expect(result.value.events).toEqual([
      "request.failed",
      "account.unavailable",
      "token.refresh_failed",
    ]);
  });

  it("does not mutate the caller input", () => {
    const input = validCreate({ events: ["request.failed"] });
    const snapshot = structuredClone(input);

    validateDestinationInput(input);

    expect(input).toEqual(snapshot);
  });
});

describe("validateDestinationInput rejects", () => {
  it("rejects an unknown event type", () => {
    const result = validateDestinationInput(validCreate({ events: ["provider.down"] }));

    expect(result.ok).toBe(false);
    expect(codesOf(result)).toContain("unknown_event");
    expect(fieldsOf(result)).toContain("events");
  });

  it("rejects duplicate and empty event subscriptions", () => {
    const duplicate = validateDestinationInput(
      validCreate({ events: ["request.failed", "request.failed"] }),
    );
    const empty = validateDestinationInput(validCreate({ events: [] }));

    expect(codesOf(duplicate)).toContain("duplicate_event");
    expect(codesOf(empty)).toContain("events_required");
  });

  it("rejects unknown top-level keys instead of mass-assigning them", () => {
    const result = validateDestinationInput(validCreate({ template: "{{payload}}", method: "PUT" }));

    expect(result.ok).toBe(false);
    expect(codesOf(result)).toContain("unknown_key");
    expect(fieldsOf(result)).toEqual(expect.arrayContaining(["template", "method"]));
  });

  it("rejects deliveryKind and other internal fields from CRUD input", () => {
    for (const key of ["deliveryKind", "revision", "id", "createdAt", "updatedAt"]) {
      const result = validateDestinationInput(validCreate({ [key]: "test" }));

      expect(result.ok, key).toBe(false);
      expect(fieldsOf(result), key).toContain(key);
    }
    const deliveryKind = validateDestinationInput(validCreate({ deliveryKind: "test" }));
    expect(codesOf(deliveryKind)).toContain("internal_field");
  });

  it("rejects an invalid kind", () => {
    const result = validateDestinationInput(validCreate({ kind: "teams" }));

    expect(codesOf(result)).toContain("invalid_kind");
    expect(fieldsOf(result)).toContain("kind");
  });

  it("rejects urls carrying userinfo", () => {
    const result = validateDestinationInput(
      validCreate({ kind: "generic", url: "https://user:pass@hooks.example.com/ingest" }),
    );

    expect(codesOf(result)).toContain("url_userinfo");
    expect(fieldsOf(result)).toContain("url");
  });

  it("rejects urls carrying a fragment", () => {
    const result = validateDestinationInput(
      validCreate({ kind: "generic", url: GENERIC_URL }),
    );

    expect(codesOf(result)).toContain("url_fragment");
  });

  it("rejects non-http(s) protocols and malformed urls", () => {
    for (const url of [
      "ftp://hooks.example.com/ingest",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "//hooks.example.com/ingest",
      "not a url",
      "https://",
    ]) {
      const result = validateDestinationInput(validCreate({ kind: "generic", url }));

      expect(result.ok, url).toBe(false);
      expect(
        codesOf(result).some((code) => code === "url_protocol" || code === "invalid_url"),
        url,
      ).toBe(true);
    }
  });

  it("rejects url longer than 2048 and name longer than 80", () => {
    const longUrl = `https://hooks.example.com/${"a".repeat(2048)}`;
    const longName = "n".repeat(81);

    expect(codesOf(validateDestinationInput(validCreate({ kind: "generic", url: longUrl })))).toContain(
      "url_too_long",
    );
    expect(codesOf(validateDestinationInput(validCreate({ name: longName })))).toContain(
      "name_too_long",
    );
  });

  it("rejects cooldown outside 0..3600, non-integers and non-booleans", () => {
    for (const cooldownSeconds of [-1, 3601, 12.5, "300"]) {
      const result = validateDestinationInput(validCreate({ cooldownSeconds }));

      expect(result.ok, String(cooldownSeconds)).toBe(false);
      expect(codesOf(result)).toContain("cooldown_out_of_range");
    }
  });

  it("rejects headers on discord and slack destinations", () => {
    const result = validateDestinationInput(
      validCreate({ headers: { Authorization: "Bearer dummy" } }),
    );

    expect(codesOf(result)).toContain("headers_not_supported");
  });

  it("rejects more than 8 headers", () => {
    const headers = Object.fromEntries(
      Array.from({ length: 9 }, (_, index) => [`X-H${index}`, "value"]),
    );
    const result = validateDestinationInput(
      validCreate({ kind: "generic", headers }),
    );

    expect(codesOf(result)).toContain("header_count_limit");
  });

  it("rejects header names outside Authorization and X-*", () => {
    for (const name of ["Content-Type", "Host", "Cookie", "Forwarded", "X-Forwarded-For"]) {
      const result = validateDestinationInput(
        validCreate({ kind: "generic", headers: { [name]: "value" } }),
      );

      expect(result.ok, name).toBe(false);
      expect(
        codesOf(result).some(
          (code) => code === "header_name_not_allowed" || code === "header_name_forbidden",
        ),
        name,
      ).toBe(true);
    }

    for (const name of WEBHOOK_FORBIDDEN_HEADER_NAMES) {
      const result = validateDestinationInput(
        validCreate({ kind: "generic", headers: { [name]: "value" } }),
      );

      expect(result.ok, name).toBe(false);
    }
  });

  it("rejects CRLF in header values and values longer than 2048", () => {
    const crlf = validateDestinationInput(
      validCreate({ kind: "generic", headers: { "X-Tenant": "acme\r\nX-Evil: 1" } }),
    );
    const long = validateDestinationInput(
      validCreate({ kind: "generic", headers: { "X-Tenant": `a${"b".repeat(2048)}` } }),
    );

    expect(codesOf(crlf)).toContain("header_value_invalid");
    expect(codesOf(long)).toContain("header_value_too_long");
  });

  it("rejects missing or empty required fields", () => {
    for (const input of [{ kind: "discord", url: DISCORD_URL }, { name: "Ops", url: DISCORD_URL }]) {
      const result = validateDestinationInput(input);

      expect(result.ok).toBe(false);
      expect(codesOf(result)).toContain("required");
    }

    expect(codesOf(validateDestinationInput(validCreate({ name: "   " })))).toContain(
      "name_required",
    );
  });

  it("rejects non-boolean enabled and allowPrivateNetwork", () => {
    expect(codesOf(validateDestinationInput(validCreate({ enabled: "true" })))).toContain(
      "invalid_type",
    );
    expect(
      codesOf(validateDestinationInput(validCreate({ allowPrivateNetwork: 1 }))),
    ).toContain("invalid_type");
  });

  it("rejects non-string signingSecret, header maps and events", () => {
    expect(
      codesOf(
        validateDestinationInput(
          validCreate({ kind: "generic", signingSecret: { value: "secret" } }),
        ),
      ),
    ).toContain("invalid_type");
    expect(
      codesOf(validateDestinationInput(validCreate({ kind: "generic", headers: ["Authorization"] }))),
    ).toContain("headers_invalid");
    expect(codesOf(validateDestinationInput(validCreate({ events: "request.failed" })))).toContain(
      "invalid_type",
    );
  });

  it("rejects plain HTTP unless the destination opts into private networking", () => {
    const blocked = validateDestinationInput(
      validCreate({ kind: "generic", url: "http://hooks.example.com/ingest" }),
    );
    const allowed = validateDestinationInput(
      validCreate({
        kind: "generic",
        url: "http://hooks.example.com/ingest",
        allowPrivateNetwork: true,
      }),
    );

    expect(codesOf(blocked)).toContain("http_requires_private_opt_in");
    expect(allowed.ok).toBe(true);
  });

  it("rejects urls containing raw whitespace or control characters", () => {
    for (const url of [
      "https://hooks.example.com/a b",
      "https://hooks.example.com/a\tb",
      "https://hooks.example.com/a\nb",
      "https://hooks.example.com/\u0000x",
    ]) {
      const result = validateDestinationInput(validCreate({ kind: "generic", url }));

      expect(result.ok, url).toBe(false);
      expect(codesOf(result), url).toContain("invalid_url");
    }
  });

  it("rejects case-insensitive duplicate header names", () => {
    const result = validateDestinationInput(
      validCreate({ kind: "generic", headers: { "X-Tenant": "a", "x-tenant": "b" } }),
    );

    expect(codesOf(result)).toContain("header_duplicate");
  });

  it("rejects every X-Forwarded-* prefix and signature spoofing header", () => {
    for (const name of ["X-Forwarded-Custom", "X-Webhook-Signature", "x-original-URL"]) {
      const result = validateDestinationInput(
        validCreate({ kind: "generic", headers: { [name]: "value" } }),
      );

      expect(result.ok, name).toBe(false);
      expect(codesOf(result), name).toContain("header_name_not_allowed");
    }
  });

  it("returns a structured error instead of throwing on null, array or scalar input", () => {
    for (const input of [null, [], "destination", 42]) {
      const result = validateDestinationInput(input);

      expect(result.ok, String(input)).toBe(false);
      expect(codesOf(result)).toContain("invalid_type");
    }
  });
});

describe("destination patch semantics", () => {
  it("omits untouched secrets and headers so the repository can preserve them", () => {
    const result = validateDestinationInput({ name: "Renamed" }, { mode: "patch" });

    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ name: "Renamed" });
    expect(result.value).not.toHaveProperty("signingSecret");
    expect(result.value).not.toHaveProperty("headers");
    expect(result.value).not.toHaveProperty("url");
  });

  it("keeps replacement secrets and headers when explicitly provided", () => {
    const result = validateDestinationInput(
      {
        signingSecret: "whsec_replacement",
        headers: { "X-Tenant": "beta" },
        cooldownSeconds: 0,
      },
      { mode: "patch" },
    );

    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({
      signingSecret: "whsec_replacement",
      headers: { "X-Tenant": "beta" },
      cooldownSeconds: 0,
    });
  });

  it("clears secrets and headers only through explicit validated clear fields", () => {
    const result = validateDestinationInput(
      { clearSigningSecret: true, clearHeaders: true },
      { mode: "patch" },
    );

    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ clearSigningSecret: true, clearHeaders: true });
    expect(result.value).not.toHaveProperty("signingSecret");
    expect(result.value).not.toHaveProperty("headers");
  });

  it("rejects non-boolean clear flags and still validates provided patch values", () => {
    expect(
      codesOf(
        validateDestinationInput({ clearSigningSecret: "yes" }, { mode: "patch" }),
      ),
    ).toContain("invalid_type");

    const invalidPatch = validateDestinationInput(
      { kind: "generic", url: "https://user:pass@hooks.example.com/x" },
      { mode: "patch" },
    );
    expect(codesOf(invalidPatch)).toContain("url_userinfo");
  });

  it("does not accept clear flags on create", () => {
    const result = validateDestinationInput(validCreate({ clearHeaders: true }));

    expect(result.ok).toBe(false);
    expect(codesOf(result)).toContain("unknown_key");
  });

  it("rejects conflicting explicit clear and replacement values", () => {
    const secret = validateDestinationInput(
      { clearSigningSecret: true, signingSecret: "whsec_new" },
      { mode: "patch" },
    );
    const headers = validateDestinationInput(
      { clearHeaders: true, headers: { "X-Tenant": "beta" } },
      { mode: "patch" },
    );

    expect(codesOf(secret)).toContain("conflicting_clear");
    expect(codesOf(headers)).toContain("conflicting_clear");
  });

  it("defers kind-dependent header checks on partial patches but rejects contradictions", () => {
    const deferred = validateDestinationInput(
      { headers: { "X-Tenant": "beta" } },
      { mode: "patch" },
    );
    const contradictory = validateDestinationInput(
      { kind: "discord", headers: { "X-Tenant": "beta" } },
      { mode: "patch" },
    );

    expect(deferred.ok).toBe(true);
    expect(codesOf(contradictory)).toContain("headers_not_supported");
  });

  it("defers HTTP opt-in when a patch omits the network policy", () => {
    const deferred = validateDestinationInput(
      { url: "http://hooks.example.com/ingest" },
      { mode: "patch" },
    );
    const explicitDeny = validateDestinationInput(
      { url: "http://hooks.example.com/ingest", allowPrivateNetwork: false },
      { mode: "patch" },
    );

    expect(deferred.ok).toBe(true);
    expect(deferred.value.url).toBe("http://hooks.example.com/ingest");
    expect(codesOf(explicitDeny)).toContain("http_requires_private_opt_in");
  });
});

describe("safe destination DTO", () => {
  it("exposes only scheme and host, never path or query", () => {
    const dto = toSafeDestination(rawDestination());

    expect(dto).toMatchObject({
      id: "wd_1",
      revision: 7,
      name: "Ops alerts",
      kind: "generic",
      enabled: true,
      url: { scheme: "https", host: "hooks.example.com" },
      urlConfigured: true,
    });
    expect(dto.url).not.toHaveProperty("pathname");
    expect(dto.url).not.toHaveProperty("search");
    expect(dto.url).not.toHaveProperty("hash");
    expect(JSON.stringify(dto)).not.toContain("tenant=acme");
    expect(JSON.stringify(dto)).not.toContain("/ingest/v1");
    expect(JSON.stringify(dto)).not.toContain("#frag");
  });

  it("never serializes signing secrets or header values", () => {
    const serialized = JSON.stringify(toSafeDestination(rawDestination()));

    expect(serialized).not.toContain("whsec_dummy_signing_secret");
    expect(serialized).not.toContain("Bearer dummy-token");
    expect(serialized).not.toContain("acme\"");
    expect(serialized).not.toContain("dummy-token");
  });

  it("reports auth presence without revealing values", () => {
    const dto = toSafeDestination(rawDestination());

    expect(dto.hasSigningSecret).toBe(true);
    expect(dto.headerCount).toBe(2);
    expect(dto.headerNames).toEqual(expect.arrayContaining(["Authorization", "X-Tenant"]));
    expect(dto.headers).toBeUndefined();
    expect(dto.signingSecret).toBeUndefined();
    expect(dto.url).toBeDefined();
    expect(dto.urlConfigured).toBe(true);
  });

  it("keeps secrets absent when the destination has none", () => {
    const dto = toSafeDestination(
      rawDestination({ signingSecret: undefined, headers: undefined, revision: 1 }),
    );

    expect(dto.hasSigningSecret).toBe(false);
    expect(dto.headerCount).toBe(0);
    expect(dto.headerNames).toEqual([]);
    expect(dto.revision).toBe(1);
  });

  it("does not throw on a malformed stored url and reports it unconfigured", () => {
    const dto = toSafeDestination(rawDestination({ url: "not a url" }));

    expect(dto.url).toBeNull();
    expect(dto.urlConfigured).toBe(false);
    expect(JSON.stringify(dto)).not.toContain("not a url");
  });
});

describe("event data and envelope validation", () => {
  it("accepts the allowlisted event data fields", () => {
    const result = validateEventData({
      requestId: "req_1",
      modality: "chat",
      provider: "glm",
      model: "glm-4.7",
      connectionId: "conn_1",
      statusCode: 500,
      errorClass: "upstream_http",
      partialResponse: false,
    });

    expect(result.ok).toBe(true);
    expect(result.value.errorClass).toBe("upstream_http");
  });

  it("rejects unknown data keys including prompt, completion and raw upstream text", () => {
    for (const key of ["prompt", "completion", "stack", "upstreamMessage", "email", "url"]) {
      const result = validateEventData({ requestId: "req_1", [key]: "leak" });

      expect(result.ok, key).toBe(false);
      expect(codesOf(result)).toContain("unknown_key");
      expect(fieldsOf(result)).toContain(key);
    }
  });

  it("rejects unknown error classes and non-object data", () => {
    expect(codesOf(validateEventData({ errorClass: "provider_exploded" }))).toContain(
      "invalid_error_class",
    );
    expect(codesOf(validateEventData("request failed"))).toContain("invalid_type");
  });

  it("accepts a valid event envelope with schema_version 1", () => {
    const result = validateEventEnvelope({
      id: crypto.randomUUID(),
      type: "account.unavailable",
      schema_version: 1,
      occurred_at: "2026-10-18T00:00:00.000Z",
      severity: "warning",
      data: { provider: "glm", connectionId: "conn_1", errorClass: "refresh_failed" },
    });

    expect(result.ok).toBe(true);
    expect(result.value.type).toBe("account.unavailable");
  });

  it("rejects unknown envelope types, schema versions and non-uuid ids", () => {
    const base = {
      id: crypto.randomUUID(),
      type: "request.failed",
      schema_version: 1,
      occurred_at: "2026-10-18T00:00:00.000Z",
      severity: "error",
      data: { requestId: "req_1" },
    };

    expect(codesOf(validateEventEnvelope({ ...base, type: "provider.down" }))).toContain(
      "unknown_event",
    );
    expect(codesOf(validateEventEnvelope({ ...base, schema_version: 2 }))).toContain(
      "invalid_envelope",
    );
    expect(codesOf(validateEventEnvelope({ ...base, id: "not-a-uuid" }))).toContain(
      "invalid_envelope",
    );
  });

  it("rejects severity mismatch and unknown envelope keys", () => {
    const base = {
      id: crypto.randomUUID(),
      type: "request.failed",
      schema_version: 1,
      occurred_at: "2026-10-18T00:00:00.000Z",
      severity: "error",
      data: { requestId: "req_1" },
    };

    expect(codesOf(validateEventEnvelope({ ...base, severity: "warning" }))).toContain(
      "severity_mismatch",
    );
    expect(codesOf(validateEventEnvelope({ ...base, deliveryKind: "test" }))).toContain(
      "unknown_key",
    );
  });

  it("rejects typed violations and nested objects inside allowlisted data", () => {
    expect(codesOf(validateEventData({ statusCode: 99 }))).toContain("invalid_status_code");
    expect(codesOf(validateEventData({ statusCode: "500" }))).toContain("invalid_status_code");
    expect(codesOf(validateEventData({ partialResponse: "false" }))).toContain("invalid_type");
    expect(codesOf(validateEventData({ requestId: { nested: "leak" } }))).toContain("invalid_type");
    expect(codesOf(validateEventData({ provider: "p".repeat(257) }))).toContain("field_too_long");
  });
});

describe("bounded policy helpers", () => {
  it("accepts exactly 20 destinations and rejects the 21st", () => {
    expect(checkDestinationCapacity(20).ok).toBe(true);

    const over = checkDestinationCapacity(21);
    expect(over.ok).toBe(false);
    expect(codesOf(over)).toContain("destination_limit");
    expect(checkDestinationCapacity(WEBHOOK_LIMITS.maxDestinations - 1).ok).toBe(true);
  });

  it("accepts exactly 16 KiB of UTF-8 payload and rejects one more byte", () => {
    const atLimit = "a".repeat(WEBHOOK_LIMITS.maxPayloadBytes);
    const overLimit = "a".repeat(WEBHOOK_LIMITS.maxPayloadBytes + 1);

    expect(validatePayloadSize(atLimit).ok).toBe(true);
    expect(validatePayloadSize(atLimit).bytes).toBe(16384);
    expect(codesOf(validatePayloadSize(overLimit))).toContain("payload_too_large");
  });

  it("measures multibyte payloads in UTF-8 bytes, not code units", () => {
    const atLimit = "é".repeat(WEBHOOK_LIMITS.maxPayloadBytes / 2);
    const overLimit = "é".repeat(WEBHOOK_LIMITS.maxPayloadBytes / 2 + 1);

    expect(validatePayloadSize(atLimit).ok).toBe(true);
    expect(validatePayloadSize(atLimit).bytes).toBe(16384);
    expect(validatePayloadSize(overLimit).ok).toBe(false);
  });

  it("serializes object payloads before measuring and reports the byte count", () => {
    const result = validatePayloadSize({ requestId: "req_1", errorClass: "internal" });

    expect(result.ok).toBe(true);
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.bytes).toBeLessThan(WEBHOOK_LIMITS.maxPayloadBytes);
  });

  it("returns a structured error for cyclic or unserializable payloads", () => {
    const cyclic = { requestId: "req_1" };
    cyclic.self = cyclic;

    const result = validatePayloadSize(cyclic);
    expect(result.ok).toBe(false);
    expect(codesOf(result)).toContain("payload_unserializable");
    expect(() => validatePayloadSize(cyclic)).not.toThrow();

    expect(codesOf(validatePayloadSize(undefined))).toContain("invalid_type");
    expect(codesOf(validatePayloadSize(10n))).toContain("payload_unserializable");
  });

  it("rejects non-integer destination counts", () => {
    expect(codesOf(checkDestinationCapacity("20"))).toContain("invalid_type");
    expect(codesOf(checkDestinationCapacity(-1))).toContain("invalid_type");
  });
});
