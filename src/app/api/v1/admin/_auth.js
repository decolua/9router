import { resolveApiKeyRecord } from "@/lib/localDb";
import { extractApiKey } from "@/shared/utils/extractApiKey";

// Returns { record, rawKey } or throws a Response.
// Callers should wrap in try/catch and return the thrown Response.
export async function requireKey(request) {
  const raw = extractApiKey(request);
  if (!raw) {
    throw new Response(JSON.stringify({ error: "API key required" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const record = await resolveApiKeyRecord(raw);
  if (!record) {
    throw new Response(JSON.stringify({ error: "Invalid API key" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!record.isActive) {
    throw new Response(JSON.stringify({ error: "Inactive API key" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return { record, rawKey: raw };
}

// Throws 403 if record.role !== "admin".
export function requireAdmin(record) {
  if (!record || record.role !== "admin") {
    throw new Response(JSON.stringify({ error: "admin role required" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// Strip the raw `key` field before exposing a record via the management API.
export function publicKeyView(record) {
  if (!record) return null;
  const { key, ...rest } = record;
  return rest;
}
