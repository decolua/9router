'use strict';

function findObjectFieldValueStart(text, objStart, keys) {
  if (!text || objStart < 0 || objStart >= text.length || text[objStart] !== '{') {
    return -1;
  }
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = objStart; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === quote) {
        quote = '';
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      if (depth === 1) {
        const parsed = parseJSONStringLiteral(text, i);
        if (!parsed) {
          return -1;
        }
        let j = skipSpaces(text, parsed.end);
        if (j >= text.length || text[j] !== ':') {
          i = parsed.end - 1;
          continue;
        }
        j = skipSpaces(text, j + 1);
        if (j >= text.length) {
          return -1;
        }
        if (keys.includes(parsed.value)) {
          return j;
        }
        i = j - 1;
        continue;
      }
      quote = ch;
      continue;
    }
    if (ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        break;
      }
    }
  }
  return -1;
}

function parseJSONStringLiteral(text, start) {
  if (!text || start < 0 || start >= text.length || text[start] !== '"') {
    return null;
  }
  let out = '';
  let escaped = false;
  for (let i = start + 1; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      return { value: out, end: i + 1 };
    }
    out += ch;
  }
  return null;
}

function skipSpaces(text, i) {
  let idx = i;
  while (idx < text.length) {
    const ch = text[idx];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      idx += 1;
      continue;
    }
    break;
  }
  return idx;
}

function extractJSONObjectFrom(text, start) {
  if (!text || start < 0 || start >= text.length || text[start] !== '{') {
    return { ok: false, end: 0 };
  }
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === quote) {
        quote = '';
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return { ok: true, end: i + 1 };
      }
    }
  }
  return { ok: false, end: 0 };
}

function trimWrappingJSONFence(prefix, suffix) {
  const rightTrimmedPrefix = (prefix || '').replace(/[ \t\r\n]+$/g, '');
  const fenceIdx = rightTrimmedPrefix.lastIndexOf('```');
  if (fenceIdx < 0) return { prefix, suffix };
  const fenceCount = (rightTrimmedPrefix.slice(0, fenceIdx + 3).match(/```/g) || []).length;
  if (fenceCount % 2 === 0) {
    return { prefix, suffix };
  }
  const header = rightTrimmedPrefix.slice(fenceIdx + 3).trim().toLowerCase();
  if (header && header !== 'json') {
    return { prefix, suffix };
  }
  const leftTrimmedSuffix = (suffix || '').replace(/^[ \t\r\n]+/g, '');
  if (!leftTrimmedSuffix.startsWith('```')) {
    return { prefix, suffix };
  }
  const consumed = (suffix || '').length - leftTrimmedSuffix.length;
  return {
    prefix: rightTrimmedPrefix.slice(0, fenceIdx),
    suffix: (suffix || '').slice(consumed + 3),
  };
}

module.exports = {
  findObjectFieldValueStart,
  parseJSONStringLiteral,
  skipSpaces,
  extractJSONObjectFrom,
  trimWrappingJSONFence,
};
