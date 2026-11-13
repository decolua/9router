import { TOKEN_SAVER_MODULES, TOKEN_SAVER_POLICY_FIELDS } from "@/shared/constants/tokenSaver.js";

export function validateTokenSaverInput(input) {
  if (input === null) return { ok: true, value: null };
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "tokenSaver must be null or a policy object" };
  }
  if (Object.keys(input).some((field) => !TOKEN_SAVER_POLICY_FIELDS.includes(field))) {
    return { ok: false, error: "tokenSaver contains unsupported fields" };
  }
  for (const field of TOKEN_SAVER_POLICY_FIELDS) {
    if (!Object.hasOwn(input, field) || typeof input[field] !== "boolean") {
      return { ok: false, error: `tokenSaver.${field} must be a boolean` };
    }
  }
  return { ok: true, value: Object.fromEntries(TOKEN_SAVER_POLICY_FIELDS.map((field) => [field, input[field]])) };
}

// Stored per-key policy, distinct from the request-header opt-out.
export function tokenSaverFromColumn(raw) {
  try {
    const checked = validateTokenSaverInput(JSON.parse(raw));
    return checked.ok ? checked.value : null;
  } catch {
    return null;
  }
}

export function resolveTokenSaverFlags(settings, policy) {
  return Object.fromEntries(TOKEN_SAVER_MODULES.map(({ field }) => [
    field,
    policy?.overrideEnabled === true
      ? policy.enabled === true && policy[field] === true
      : Boolean(settings[field]),
  ]));
}
