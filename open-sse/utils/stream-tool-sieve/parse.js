'use strict';

const {
  toStringSafe,
} = require('./state');
const {
  parseMarkupToolCalls,
  stripFencedCodeBlocks,
  containsToolCallWrapperSyntaxOutsideIgnored,
  normalizeDSMLToolCallMarkup,
  hasRepairableXMLToolCallsWrapper,
  indexToolCDATAOpen,
  sanitizeLooseCDATA,
} = require('./parse_payload');

function extractToolNames(tools) {
  if (!Array.isArray(tools) || tools.length === 0) {
    return [];
  }
  const out = [];
  const seen = new Set();
  for (const t of tools) {
    if (!t || typeof t !== 'object') {
      continue;
    }
    const fn = t.function && typeof t.function === 'object' ? t.function : t;
    const name = toStringSafe(fn.name);
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    out.push(name);
  }
  return out;
}

function parseToolCalls(text, toolNames) {
  return parseToolCallsDetailed(text, toolNames).calls;
}

function parseToolCallsDetailed(text, toolNames) {
  const result = emptyParseResult();
  const raw = toStringSafe(text);
  if (!raw) {
    return result;
  }
  if (shouldSkipToolCallParsingForCodeFenceExample(raw)) {
    return result;
  }
  const normalized = normalizeDSMLToolCallMarkup(stripFencedCodeBlocks(raw).trim());
  if (!normalized.ok || !normalized.text) {
    return result;
  }
  result.sawToolCallSyntax = looksLikeToolCallSyntax(normalized.text) || hasRepairableXMLToolCallsWrapper(normalized.text);
  // XML markup parsing only.
  let parsed = parseMarkupToolCalls(normalized.text);
  if (parsed.length === 0 && indexToolCDATAOpen(normalized.text, 0) >= 0) {
    const recovered = sanitizeLooseCDATA(normalized.text);
    if (recovered !== normalized.text) {
      parsed = parseMarkupToolCalls(recovered);
    }
  }
  if (parsed.length === 0) {
    return result;
  }
  result.sawToolCallSyntax = true;
  const filtered = filterToolCallsDetailed(parsed, toolNames);
  result.calls = filtered.calls;
  result.rejectedToolNames = filtered.rejectedToolNames;
  result.rejectedByPolicy = filtered.rejectedToolNames.length > 0 && filtered.calls.length === 0;
  return result;
}

function parseStandaloneToolCalls(text, toolNames) {
  return parseStandaloneToolCallsDetailed(text, toolNames).calls;
}

function parseStandaloneToolCallsDetailed(text, toolNames) {
  const result = emptyParseResult();
  const raw = toStringSafe(text);
  if (!raw) {
    return result;
  }
  if (shouldSkipToolCallParsingForCodeFenceExample(raw)) {
    return result;
  }
  const normalized = normalizeDSMLToolCallMarkup(stripFencedCodeBlocks(raw).trim());
  if (!normalized.ok || !normalized.text) {
    return result;
  }
  result.sawToolCallSyntax = looksLikeToolCallSyntax(normalized.text) || hasRepairableXMLToolCallsWrapper(normalized.text);
  // XML markup parsing only.
  let parsed = parseMarkupToolCalls(normalized.text);
  if (parsed.length === 0 && indexToolCDATAOpen(normalized.text, 0) >= 0) {
    const recovered = sanitizeLooseCDATA(normalized.text);
    if (recovered !== normalized.text) {
      parsed = parseMarkupToolCalls(recovered);
    }
  }
  if (parsed.length === 0) {
    return result;
  }

  result.sawToolCallSyntax = true;
  const filtered = filterToolCallsDetailed(parsed, toolNames);
  result.calls = filtered.calls;
  result.rejectedToolNames = filtered.rejectedToolNames;
  result.rejectedByPolicy = filtered.rejectedToolNames.length > 0 && filtered.calls.length === 0;
  return result;
}

function emptyParseResult() {
  return {
    calls: [],
    sawToolCallSyntax: false,
    rejectedByPolicy: false,
    rejectedToolNames: [],
  };
}

function filterToolCallsDetailed(parsed, toolNames) {
  const calls = [];
  for (const tc of parsed) {
    if (!tc || !tc.name) {
      continue;
    }
    const input = tc.input && typeof tc.input === 'object' && !Array.isArray(tc.input) ? tc.input : {};
    calls.push({
      name: tc.name,
      input,
    });
  }
  return { calls, rejectedToolNames: [] };
}

function looksLikeToolCallSyntax(text) {
  const styles = containsToolCallWrapperSyntaxOutsideIgnored(text);
  return styles.dsml || styles.canonical;
}

function shouldSkipToolCallParsingForCodeFenceExample(text) {
  if (!looksLikeToolCallSyntax(text)) {
    return false;
  }
  const stripped = stripFencedCodeBlocks(text);
  return !looksLikeToolCallSyntax(stripped);
}

module.exports = {
  extractToolNames,
  parseToolCalls,
  parseToolCallsDetailed,
  parseStandaloneToolCalls,
  parseStandaloneToolCallsDetailed,
};
