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
];

export const PATTERN_BY_ID = Object.fromEntries(PII_TYPES.map((t) => [t.id, t]));

export const DEFAULT_TYPES = ["email", "phone", "cpf", "cnpj", "creditCard", "ip", "apiKey"];