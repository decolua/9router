// Deterministic pseudonym generators and the in-memory real→fake mapping
// table. In-memory only: nothing is persisted; a restart clears the table.

import { isValidCnpj, isValidCpf, luhnValid } from "./patterns.js";

export const REDACT_LABEL = "[PII-REDACTED]";

const MAPPING_CAP = 10_000;
const mapping = new Map(); // key: `type\u0000normalizedReal` -> fake

const DIGITS = (s) => s.replace(/\D/g, "");
const DIGIT_KEYED = new Set(["cpf", "cnpj", "phone", "cep", "creditCard", "ip"]);

export function normalizeRealKey(type, real) {
  return DIGIT_KEYED.has(type) ? DIGITS(real) : real;
}

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const pad = (n, len) => String(n).padStart(len, "0");

// Valid CPF generated from a seed (same algorithm as isValidCpf).
function generateValidCpf(seed) {
  const d = [];
  for (let i = 0; i < 9; i++) d.push((seed + i * 7) % 10);
  const checkDigit = (len) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += d[i] * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  d.push(checkDigit(9));
  d.push(checkDigit(10));
  return d.join("");
}

// Valid CNPJ generated from a seed (same algorithm as isValidCnpj).
function generateValidCnpj(seed) {
  const d = [];
  for (let i = 0; i < 12; i++) d.push((seed + i * 3) % 10);
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const calc = (weights) => {
    let sum = 0;
    for (let i = 0; i < weights.length; i++) sum += d[i] * weights[i];
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  d.push(calc(w1));
  d.push(calc(w2));
  return d.join("");
}

// Luhn-valid 16-digit card from a seed (never a real card).
function generateLuhnCard(seed) {
  const d = [];
  for (let i = 0; i < 15; i++) d.push((seed + i * 3) % 10);
  let sum = 0;
  let alt = true;
  for (let i = 14; i >= 0; i--) {
    let n = d[i];
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  d.push((10 - (sum % 10)) % 10);
  return d.join("").replace(/(\d{4})(?=\d)/g, "$1 ");
}

const formatCpf = (s) => `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9, 11)}`;
const formatCnpj = (s) => `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12, 14)}`;

function generate(type, real) {
  const seed = fnv1a(`${type}:${real}`);
  switch (type) {
    case "email":
      return `user${seed.toString(16).slice(0, 6)}@example.com`;
    case "phone":
      return `+55 11 9${pad(seed % 10_000_000, 8)}`;
    case "cpf":
      return formatCpf(generateValidCpf(seed));
    case "cnpj":
      return formatCnpj(generateValidCnpj(seed));
    case "cep": {
      const n = seed % 1_000_000;
      return `${pad(Math.floor(n / 1000), 5)}-${pad(n % 1000, 3)}`;
    }
    case "creditCard":
      return generateLuhnCard(seed);
    case "ip":
      return `10.${(seed >>> 8) & 255}.${(seed >>> 16) & 255}.${seed & 255}`;
    case "apiKey":
      return `sk-masked-${seed.toString(16).slice(0, 16)}`;
    default:
      return getPseudonymForCustom(real);
  }
}

export function getPseudonymForCustom(real) {
  return `[PII-${fnv1a(`custom:${real}`).toString(16).slice(0, 6)}]`;
}

export function getPseudonym(type, real) {
  const key = `${type}\u0000${normalizeRealKey(type, real)}`;
  if (mapping.has(key)) return mapping.get(key);
  const fake = generate(type, real);
  if (mapping.size >= MAPPING_CAP) {
    mapping.delete(mapping.keys().next().value); // evict oldest (insertion order)
  }
  mapping.set(key, fake);
  return fake;
}

export function getMapping(limit = 500) {
  const entries = [];
  for (const [key, fake] of mapping) {
    const [type, real] = key.split("\u0000");
    entries.push({ type, real, fake });
  }
  return { entries: entries.slice(-limit).reverse(), count: entries.length, limit };
}

export function clearMapping() {
  const n = mapping.size;
  mapping.clear();
  return n;
}