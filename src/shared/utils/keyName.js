// Shared validation for an API key's display name (create + rename).
export const KEY_NAME_MAX_LENGTH = 100;

/**
 * @param {unknown} input
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
export function validateKeyName(input) {
  if (typeof input !== "string") return { ok: false, error: "Name is required" };
  const value = input.trim();
  if (!value) return { ok: false, error: "Name is required" };
  if (value.length > KEY_NAME_MAX_LENGTH) {
    return { ok: false, error: `Name must be ${KEY_NAME_MAX_LENGTH} characters or fewer` };
  }
  return { ok: true, value };
}
