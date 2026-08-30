// Password complexity policy and validator conforming to OWASP ASVS v5.0.0 (6.1.1 & 6.1.2)

const COMMON_WEAK_PASSWORDS = new Set([
  "123456",
  "12345678",
  "123456789",
  "1234567890",
  "password",
  "password123",
  "admin",
  "admin123",
  "root",
  "root123",
  "qwerty",
  "letmein",
  "welcome",
  "pass1234",
  "default",
  "changeme",
  "change-me",
]);

/**
 * Validates password strength and returns validation status with detailed errors.
 * @param {string} password
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePasswordStrength(password) {
  const errors = [];

  if (typeof password !== "string" || !password) {
    return { valid: false, errors: ["Password cannot be empty."] };
  }

  // Length check (minimum 10 characters)
  if (password.length < 10) {
    errors.push("Password must be at least 10 characters long.");
  }

  if (password.length > 128) {
    errors.push("Password cannot exceed 128 characters.");
  }

  // Blocklist check
  if (COMMON_WEAK_PASSWORDS.has(password.toLowerCase().trim())) {
    errors.push("Password is too common and easily guessable.");
  }

  // Repetitive characters (e.g., "aaaaaa", "111111")
  if (/(.)\1{4,}/.test(password)) {
    errors.push("Password cannot consist of repeating single characters.");
  }

  // Sequential pattern check
  if (
    "01234567890123456789".includes(password.toLowerCase()) ||
    "abcdefghijklmnopqrstuvwxyz".includes(password.toLowerCase()) ||
    "qwertyuiopasdfghjklzxcvbnm".includes(password.toLowerCase())
  ) {
    errors.push("Password cannot be a simple sequential keyboard pattern.");
  }

  // Diversity check: at least 3 of [uppercase, lowercase, digits, special characters]
  let diversityScore = 0;
  if (/[A-Z]/.test(password)) diversityScore++;
  if (/[a-z]/.test(password)) diversityScore++;
  if (/[0-9]/.test(password)) diversityScore++;
  if (/[^A-Za-z0-9]/.test(password)) diversityScore++;

  if (diversityScore < 3) {
    errors.push(
      "Password must contain characters from at least 3 categories: uppercase letters, lowercase letters, numbers, or special symbols."
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Quick check if a password is considered weak.
 * @param {string} password
 * @returns {boolean}
 */
export function isWeakPassword(password) {
  return !validatePasswordStrength(password).valid;
}
