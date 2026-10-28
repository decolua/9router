// Values shipped in public documentation are not operator secrets. Treat them like
// the built-in default so they cannot be used to obtain a remote dashboard session.
const PLACEHOLDER_INITIAL_PASSWORDS = new Set([
  "change-me",
  "your-password",
  "your-secure-password",
  "votre-mot-de-passe",
  "tu-contraseña",
]);

export function isPlaceholderInitialPassword(value) {
  return PLACEHOLDER_INITIAL_PASSWORDS.has(String(value ?? "").trim());
}

export function hasOperatorInitialPassword() {
  const value = process.env.INITIAL_PASSWORD;
  return Boolean(value) && !isPlaceholderInitialPassword(value);
}
