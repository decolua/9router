// Per-API-key access control: shared constants. Used by the engine
// (src/sse/services/keyAccess.js), the DB repo, the /api/keys routes and the
// Endpoint page.

// Upper bounds for one key's allow list. The API rejects input beyond these
// (400) rather than truncating it, so a declared list is never silently cut.
export const KEY_ACCESS_MAX_ENTRIES = 200;
export const KEY_ACCESS_MAX_ENTRY_LENGTH = 256;

// Every key — new, migrated, or restored from a backup without the field — is
// unrestricted unless explicitly switched to restricted.
export const KEY_ACCESS_UNRESTRICTED = Object.freeze({ restricted: false, allow: Object.freeze([]) });

// /v1/models entry kinds whose "model" is the provider itself (search/fetch).
export const KEY_ACCESS_PROVIDER_AS_MODEL_KINDS = Object.freeze(["webSearch", "webFetch"]);

// /v1/models owner tag for combo entries.
export const KEY_ACCESS_COMBO_OWNER = "combo";

// Client-facing 403 message. Names only what the client itself sent: never the
// key name or the key's allow list.
export function keyAccessDeniedMessage(requested) {
  return `This API key is not allowed to use model "${requested}"`;
}
