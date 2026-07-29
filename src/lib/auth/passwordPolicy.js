// Shared password policy for signup, password reset, and admin flows.

const MIN_LENGTH = 8;
const MAX_LENGTH = 128;

export function validatePassword(password) {
  const value = String(password || "");
  if (value.length < MIN_LENGTH) {
    return { ok: false, error: `Password must be at least ${MIN_LENGTH} characters` };
  }
  if (value.length > MAX_LENGTH) {
    return { ok: false, error: `Password must be at most ${MAX_LENGTH} characters` };
  }
  const hasLower = /[a-z]/.test(value);
  const hasUpper = /[A-Z]/.test(value);
  const hasDigit = /\d/.test(value);
  const complexity = [hasLower, hasUpper, hasDigit].filter(Boolean).length;
  if (complexity < 2) {
    return {
      ok: false,
      error: "Password must include at least two of: lowercase, uppercase, digit",
    };
  }
  return { ok: true };
}
