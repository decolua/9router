// Patterns and validation for built-in PII detection.
// Every high-false-positive type carries a validate() checksum so code and
// prose are not mass-masked. All regexes are GLOBAL (use lastIndex or match()).

// ---- Validation primitives (exported for tests and generators) ----

const DIGITS = (s) => s.replace(/\D/g, "");

export function isValidCpf(m) {
  const d = DIGITS(m);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const check = (len) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += parseInt(d[i], 10) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return check(9) === parseInt(d[9], 10) && check(10) === parseInt(d[10], 10);
}

export function isValidCnpj(m) {
  const d = DIGITS(m);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (len) => {
    const weights = len === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < len; i++) sum += parseInt(d[i], 10) * weights[i];
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return calc(12) === parseInt(d[12], 10) && calc(13) === parseInt(d[13], 10);
}

export function luhnValid(m) {
  const d = DIGITS(m);
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = parseInt(d[i], 10);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function isValidIpv4(m) {
  const parts = m.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && parseInt(p, 10) <= 255);
}

export function isValidSsn(m) {
  const d = DIGITS(m);
  if (d.length !== 9) return false;
  const area = parseInt(d.slice(0, 3), 10);
  // SSN areas 001-899 (666 excluded); ITIN areas 900-999 — both are valid
  // US taxpayer identification numbers.
  const ssn = area >= 1 && area <= 899 && area !== 666;
  const itin = area >= 900 && area <= 999;
  if (!ssn && !itin) return false;
  const group = parseInt(d.slice(3, 5), 10);
  if (group === 0) return false;
  const serial = parseInt(d.slice(5, 9), 10);
  if (serial === 0) return false;
  return true;
}

export function isValidEin(m) {
  const d = DIGITS(m);
  // EIN = 2-digit prefix + 7-digit number (9 digits total, one optional dash).
  if (d.length !== 9) return false;
  const prefix = parseInt(d.slice(0, 2), 10);
  if (prefix < 1 || prefix > 99) return false;
  if (new Set(d).size === 1) return false;
  return true;
}

export function isValidUsZip(m) {
  const d = DIGITS(m);
  if (d.length !== 5) return false;
  const prefix = parseInt(d.slice(0, 3), 10);
  // Leading zeros are legal (00501, 009xx PR); 001-004 and 000 have no ZIPs.
  if (prefix < 5 || prefix > 999) return false;
  if (new Set(d).size === 1) return false;
  return true;
}

export function isValidIban(m) {
  const normalized = String(m).replace(/[^A-Z0-9]/gi, "").toUpperCase();
  if (normalized.length < 15 || normalized.length > 34) return false;
  if (!/^[A-Z]{2}\d{2}/.test(normalized)) return false;
  // MOD-97-10: move the 4 first chars to the end, letters -> numbers, mod 97.
  const rearranged = normalized.slice(4) + normalized.slice(0, 4);
  const mapped = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  try {
    return BigInt(mapped) % 97n === 1n;
  } catch {
    return false;
  }
}

// ---- Password FP guards (context slots only: reject paths & doc placeholders) ----
const PASSWORD_PLACEHOLDERS = new Set([
  "changeme", "yourpassword", "yourpasswordhere", "password", "secret",
  "passwd", "example", "test", "testing", "default", "todo", "fixme",
  "null", "undefined", "xxxxx",
]);

// ---- Catalog ----

export const PII_TYPES = [
  {
    id: "email",
    name: "Email addresses",
    category: "contact",
    label: "Email",
    regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  },
  {
    id: "phone",
    name: "Phone numbers",
    category: "contact",
    label: "Phone",
    regex: /(?:\+?[1-9]\d{0,2}[\s.-]?)?(?:\(\d{2,3}\)[\s.-]?|\d{2,3}[\s.-]?)?\d{4,5}[\s.-]?\d{4}/g,
    validate: (m) => DIGITS(m).length >= 10,
  },
  {
    id: "cpf",
    name: "CPF (individual taxpayer)",
    category: "br",
    label: "CPF",
    regex: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g,
    validate: isValidCpf,
  },
  {
    id: "cnpj",
    name: "CNPJ (company taxpayer)",
    category: "br",
    label: "CNPJ",
    regex: /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g,
    validate: isValidCnpj,
  },
  {
    id: "cep",
    name: "CEP postal codes",
    category: "br",
    label: "CEP",
    regex: /\b\d{5}-\d{3}\b/g,
  },
  {
    id: "creditCard",
    name: "Credit card numbers",
    category: "financial",
    label: "Credit card",
    regex: /\b(?:\d[ -]*?){13,19}\d\b/g,
    validate: luhnValid,
  },
  {
    id: "ip",
    name: "IP addresses",
    category: "network",
    label: "IP address",
    regex: /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b|\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g,
    validate: (m) => (m.includes(".") ? isValidIpv4(m) : true),
  },
  {
    id: "apiKey",
    name: "API keys & bearer tokens",
    category: "network",
    label: "API key",
    regex: /\b(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{36}|AIza[0-9A-Za-z_-]{35}|xox[baprs]-[A-Za-z0-9-]{10,})\b|(?:Bearer\s+[A-Za-z0-9._~+/=-]{20,})/g,
  },
  {
    id: "password",
    name: "Passwords & secrets in config-style assignments",
    category: "credentials",
    label: "Password",
    // Context-based: only matches when preceded by a credential keyword, so
    // code/prose like "my password is …" is not mass-masked. Optional quotes
    // cover both `password: x` and JSON `"password": "x"`.
    regex: /\b(?:password|passwd|pwd|senha|secret)\b["']?\s*[:=]\s*["']?[^\s"'`,;\]\}]{6,}["']?/gi,
    // Value-level FP guards: reject filesystem paths (shell `PWD=/var/www`)
    // and documentation placeholders (changeme, ******, …). Weak real values
    // in a password slot (e.g. `senha: 123456`) are still masked — a slot
    // assignment is a leak regardless of strength.
    validate: (m) => {
      const sep = m.search(/[:=]/);
      if (sep < 0) return false;
      const raw = m.slice(sep + 1).replace(/^["'\s]+|["'\s]+$/g, "");
      if (raw.includes("/")) return false;
      if (raw.length < 6) return false;
      const v = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
      return v.length >= 1 && !PASSWORD_PLACEHOLDERS.has(v);
    },
  },
  {
    id: "usSsn",
    name: "US Social Security / ITIN numbers",
    category: "us",
    label: "SSN / ITIN",
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    validate: isValidSsn,
  },
  {
    id: "usEin",
    name: "US Employer Identification Numbers",
    category: "us",
    label: "EIN",
    regex: /\b\d{2}-\d{7}\b/g,
    validate: isValidEin,
  },
  {
    id: "usZip",
    name: "US ZIP codes",
    category: "us",
    label: "ZIP code",
    regex: /\b\d{5}(?:-\d{4})?\b/g,
    validate: isValidUsZip,
  },
  {
    id: "iban",
    name: "IBAN bank account numbers",
    category: "eur",
    label: "IBAN (SEPA)",
    regex: /\b[A-Z]{2}\d{2}[ ]?[A-Z0-9]{11,30}\b/g,
    validate: isValidIban,
  },
  {
    id: "eurVat",
    name: "EU VAT registration numbers",
    category: "eur",
    label: "EU VAT",
    regex: /\b(?:ATU\d{8}|BE\d{10}|BG\d{9,10}|CY\d{8}[A-Z]|CZ\d{8,10}|DE\d{9}|DK\d{8}|EE\d{9}|EL\d{9}|ES[A-Z0-9]\d{7}[A-Z0-9]|FI\d{8}|FR[A-Z0-9]{2}\d{9}|HR\d{11}|HU\d{8}|IE\d{7}[A-Z]{1,2}|IT\d{11}|LT\d{9,12}|LU\d{8}|LV\d{11}|MT\d{8}|NL\d{9}B\d{2}|PL\d{10}|PT\d{9}|RO\d{8,10}|SE\d{12}|SI\d{8}|SK\d{10})\b/g,
  },
];

export const PATTERN_BY_ID = Object.fromEntries(PII_TYPES.map((t) => [t.id, t]));

export const DEFAULT_TYPES = ["email", "phone", "cpf", "cnpj", "creditCard", "ip", "apiKey"];
