// Example INITIAL_PASSWORD values from .env.example / README / gitbook. Copied verbatim
// they are as public as the built-in default, so they must not unlock remote login.
// tests/unit/login-placeholder-initial-password.test.js fails if a doc adds a new one.
const PLACEHOLDER_INITIAL_PASSWORDS = new Set([
  "change-me",
  "your-password",
  "your-secure-password",
  "votre-mot-de-passe",
  "tu-contraseña",
]);

export function isPlaceholderInitialPassword(value) {
  return PLACEHOLDER_INITIAL_PASSWORDS.has(String(value).trim());
}

// True only when the operator set INITIAL_PASSWORD to something of their own.
export function hasOperatorInitialPassword() {
  const value = process.env.INITIAL_PASSWORD;
  return Boolean(value) && !isPlaceholderInitialPassword(value);
}
