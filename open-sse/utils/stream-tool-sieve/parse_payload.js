'use strict';

const CDATA_PATTERN = /^(?:<|〈)(?:!|！)\[CDATA\[([\s\S]*?)]](?:>|＞|〉)$/i;
const XML_ATTR_PATTERN = /\b([a-z0-9_:-]+)\s*=\s*("([^"]*)"|'([^']*)')/gi;
const TOOL_MARKUP_NAMES = [
  { raw: 'tool_calls', canonical: 'tool_calls' },
  { raw: 'tool-calls', canonical: 'tool_calls', dsmlOnly: true },
  { raw: 'toolcalls', canonical: 'tool_calls', dsmlOnly: true },
  { raw: 'invoke', canonical: 'invoke' },
  { raw: 'parameter', canonical: 'parameter' },
];

const {
  toStringSafe,
} = require('./state');

function stripFencedCodeBlocks(text) {
  const t = typeof text === 'string' ? text : '';
  if (!t) {
    return '';
  }
  const lines = t.split('\n');
  const out = [];
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;
  let inCDATA = false;
  let beforeFenceIdx = 0;

  for (let li = 0; li < lines.length; li += 1) {
    const line = lines[li];
    const lineWithNL = li < lines.length - 1 ? line + '\n' : line;

    // CDATA protection
    if (inCDATA || cdataStartsBeforeFence(line)) {
      out.push(lineWithNL);
      inCDATA = updateCDATAStateLine(inCDATA, line);
      continue;
    }

    const trimmed = line.replace(/^[ \t]+/, '');
    if (!inFence) {
      const fence = parseFenceOpenLine(trimmed);
      if (fence) {
        inFence = true;
        fenceChar = fence.ch;
        fenceLen = fence.count;
        beforeFenceIdx = out.length;
        continue;
      }
      out.push(lineWithNL);
      continue;
    }

    if (isFenceCloseLine(trimmed, fenceChar, fenceLen)) {
      inFence = false;
      fenceChar = '';
      fenceLen = 0;
    }
  }

  if (inFence) {
    // Unclosed fence: keep content before the fence started.
    if (beforeFenceIdx > 0) {
      return out.slice(0, beforeFenceIdx).join('');
    }
    return '';
  }
  return out.join('');
}

function stripMarkdownCodeSpans(text) {
  const raw = toStringSafe(text);
  if (!raw) {
    return '';
  }
  let out = '';
  for (let i = 0; i < raw.length;) {
    const skipped = skipXmlIgnoredSection(raw, i);
    if (skipped.blocked) {
      out += raw.slice(i);
      break;
    }
    if (skipped.advanced) {
      out += raw.slice(i, skipped.next);
      i = skipped.next;
      continue;
    }
    const spanEnd = markdownCodeSpanEnd(raw, i);
    if (spanEnd.ok) {
      i = spanEnd.end;
      continue;
    }
    out += raw[i];
    i += 1;
  }
  return out;
}

function markdownCodeSpanEnd(text, start) {
  const raw = toStringSafe(text);
  if (start < 0 || start >= raw.length || raw[start] !== '`') {
    return { ok: false, end: start };
  }
  const count = countLeadingChars(raw, start, '`');
  if (!count) {
    return { ok: false, end: start };
  }
  let search = start + count;
  while (search < raw.length) {
    if (raw[search] !== '`') {
      search += 1;
      continue;
    }
    const run = countLeadingChars(raw, search, '`');
    if (run === count) {
      return { ok: true, end: search + run };
    }
    search += run;
  }
  return { ok: false, end: start };
}

function countLeadingChars(text, start, ch) {
  let count = 0;
  while (start + count < text.length && text[start + count] === ch) {
    count += 1;
  }
  return count;
}

function parseFenceOpenLine(trimmed) {
  if (trimmed.length < 3) return null;
  const ch = trimmed[0];
  if (ch !== '`' && ch !== '~') return null;
  let count = 0;
  while (count < trimmed.length && trimmed[count] === ch) count++;
  if (count < 3) return null;
  return { ch, count };
}

function isFenceCloseLine(trimmed, fenceChar, fenceLen) {
  if (!fenceChar || !trimmed || trimmed[0] !== fenceChar) return false;
  let count = 0;
  while (count < trimmed.length && trimmed[count] === fenceChar) count++;
  if (count < fenceLen) return false;
  return trimmed.slice(count).trim() === '';
}

function cdataStartsBeforeFence(line) {
  const cdataIdx = indexToolCDATAOpen(line, 0);
  if (cdataIdx < 0) return false;
  const fenceIdx = Math.min(
    line.indexOf('```') >= 0 ? line.indexOf('```') : Infinity,
    line.indexOf('~~~') >= 0 ? line.indexOf('~~~') : Infinity,
  );
  return fenceIdx === Infinity || cdataIdx < fenceIdx;
}

function updateCDATAStateLine(inCDATA, line) {
  let pos = 0;
  let state = inCDATA;
  while (pos < line.length) {
    if (state) {
      let end = -1;
      let closeLen = 0;
      for (let i = pos; i < line.length; i += 1) {
        const foundLen = toolCDATACloseLenAt(line, i);
        if (foundLen > 0) {
          end = i;
          closeLen = foundLen;
          break;
        }
      }
      if (end < 0) return true;
      pos = end + closeLen;
      state = false;
      continue;
    }
    const start = indexToolCDATAOpen(line, pos);
    if (start < 0) return false;
    pos = start + toolCDATAOpenLenAt(line, start);
    state = true;
  }
  return state;
}

function parseMarkupToolCalls(text) {
  const normalized = normalizeDSMLToolCallMarkup(toStringSafe(text));
  if (!normalized.ok) {
    return [];
  }
  let raw = normalized.text.trim();
  if (!raw) {
    return [];
  }
  let wrappers = findToolCallElementBlocksOutsideIgnored(raw);
  if (wrappers.length === 0 && hasRepairableXMLToolCallsWrapper(raw)) {
    const repaired = repairMissingXMLToolCallsOpeningWrapper(raw);
    if (repaired !== raw) {
      raw = repaired;
      wrappers = findToolCallElementBlocksOutsideIgnored(raw);
    }
  }
  const out = [];
  for (const wrapper of wrappers) {
    const body = toStringSafe(wrapper.body);
    for (const block of findXmlElementBlocks(body, 'invoke')) {
      const parsed = parseMarkupSingleToolCall(block);
      if (parsed) {
        out.push(parsed);
      }
    }
  }
  return out;
}

function findToolCallElementBlocksOutsideIgnored(text) {
  const raw = toStringSafe(text);
  const out = [];
  for (let searchFrom = 0; searchFrom < raw.length;) {
    const tag = findToolMarkupTagOutsideIgnored(raw, searchFrom);
    if (!tag) {
      break;
    }
    if (tag.closing || tag.name !== 'tool_calls') {
      searchFrom = tag.end + 1;
      continue;
    }
    const closeTag = findMatchingToolMarkupClose(raw, tag);
    if (!closeTag) {
      searchFrom = tag.end + 1;
      continue;
    }
    const endDelim = xmlTagEndDelimiterLenEndingAt(raw, tag.end);
    const attrsEnd = endDelim > 0 ? tag.end + 1 - endDelim : tag.end + 1;
    out.push({
      attrs: raw.slice(tag.nameEnd, attrsEnd),
      body: raw.slice(tag.end + 1, closeTag.start),
      start: tag.start,
      end: closeTag.end + 1,
    });
    searchFrom = closeTag.end + 1;
  }
  return out;
}

function normalizeDSMLToolCallMarkup(text) {
  const raw = toStringSafe(text);
  if (!raw) {
    return { text: '', ok: true };
  }
  const canonicalized = canonicalizeToolCallCandidateSpans(raw);
  const styles = containsToolMarkupSyntaxOutsideIgnored(canonicalized);
  if (!styles.dsml && !styles.canonical) {
    return { text: canonicalized, ok: true };
  }
  return {
    text: replaceDSMLToolMarkupOutsideIgnored(canonicalized),
    ok: true,
  };
}

function containsDSMLToolMarkup(text) {
  return containsToolMarkupSyntaxOutsideIgnored(text).dsml;
}

function containsCanonicalToolMarkup(text) {
  return containsToolMarkupSyntaxOutsideIgnored(text).canonical;
}

function containsToolCallWrapperSyntaxOutsideIgnored(text) {
  const raw = toStringSafe(text);
  const styles = { dsml: false, canonical: false };
  if (!raw) {
    return styles;
  }
  for (let i = 0; i < raw.length;) {
    const skipped = skipXmlIgnoredSection(raw, i);
    if (skipped.blocked) {
      return styles;
    }
    if (skipped.advanced) {
      i = skipped.next;
      continue;
    }
    const spanEnd = markdownCodeSpanEnd(raw, i);
    if (spanEnd.ok) {
      i = spanEnd.end;
      continue;
    }
    const tag = scanToolMarkupTagAt(raw, i);
    if (tag) {
      if (tag.name !== 'tool_calls') {
        i = tag.end + 1;
        continue;
      }
      if (tag.dsmlLike) {
        styles.dsml = true;
      } else {
        styles.canonical = true;
      }
      if (styles.dsml && styles.canonical) {
        return styles;
      }
      i = tag.end + 1;
      continue;
    }
    i += 1;
  }
  return styles;
}
function containsToolMarkupSyntaxOutsideIgnored(text) {
  const raw = toStringSafe(text);
  const styles = { dsml: false, canonical: false };
  if (!raw) {
    return styles;
  }
  for (let i = 0; i < raw.length;) {
    const skipped = skipXmlIgnoredSection(raw, i);
    if (skipped.blocked) {
      return styles;
    }
    if (skipped.advanced) {
      i = skipped.next;
      continue;
    }
    const spanEnd = markdownCodeSpanEnd(raw, i);
    if (spanEnd.ok) {
      i = spanEnd.end;
      continue;
    }
    const tag = scanToolMarkupTagAt(raw, i);
    if (tag) {
      if (tag.dsmlLike) {
        styles.dsml = true;
      } else {
        styles.canonical = true;
      }
      if (styles.dsml && styles.canonical) {
        return styles;
      }
      i = tag.end + 1;
      continue;
    }
    i += 1;
  }
  return styles;
}

function replaceDSMLToolMarkupOutsideIgnored(text) {
  const raw = toStringSafe(text);
  if (!raw) {
    return '';
  }
  let out = '';
  for (let i = 0; i < raw.length;) {
    const skipped = skipXmlIgnoredSection(raw, i);
    if (skipped.blocked) {
      out += raw.slice(i);
      break;
    }
    if (skipped.advanced) {
      out += raw.slice(i, skipped.next);
      i = skipped.next;
      continue;
    }
    const spanEnd = markdownCodeSpanEnd(raw, i);
    if (spanEnd.ok) {
      out += raw.slice(i, spanEnd.end);
      i = spanEnd.end;
      continue;
    }
    const tag = scanToolMarkupTagAt(raw, i);
    if (tag) {
      out += `<${tag.closing ? '/' : ''}${tag.name}${raw.slice(tag.nameEnd, tag.end)}>`;
      i = tag.end + 1;
      continue;
    }
    out += raw[i];
    i += 1;
  }
  return out;
}

function parseMarkupSingleToolCall(block) {
  const attrs = parseTagAttributes(block.attrs);
  const name = toStringSafe(attrs.name).trim();
  if (!name) {
    return null;
  }
  const inner = toStringSafe(block.body).trim();

  if (inner) {
    try {
      const decoded = JSON.parse(inner);
      if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) {
        return {
          name,
          input: decoded.input && typeof decoded.input === 'object' && !Array.isArray(decoded.input)
            ? decoded.input
            : decoded.parameters && typeof decoded.parameters === 'object' && !Array.isArray(decoded.parameters)
              ? decoded.parameters
              : {},
        };
      }
    } catch (_err) {
      // Not JSON, continue with markup parsing.
    }
  }
  const input = {};
  for (const match of findXmlElementBlocks(inner, 'parameter')) {
    const parameterAttrs = parseTagAttributes(match.attrs);
    const paramName = toStringSafe(parameterAttrs.name).trim();
    if (!paramName) {
      continue;
    }
    appendMarkupValue(input, paramName, parseMarkupValue(match.body, paramName));
  }
  if (Object.keys(input).length === 0 && inner.trim() !== '') {
    return null;
  }
  return { name, input };
}

function findXmlElementBlocks(text, tag) {
  const source = toStringSafe(text);
  const name = toStringSafe(tag).toLowerCase();
  if (!source || !name) {
    return [];
  }
  const out = [];
  let pos = 0;
  while (pos < source.length) {
    const start = findXmlStartTagOutsideCDATA(source, name, pos);
    if (!start) {
      break;
    }
    const end = findMatchingXmlEndTagOutsideCDATA(source, name, start.bodyStart);
    if (!end) {
      pos = start.bodyStart;
      continue;
    }
    out.push({
      attrs: start.attrs,
      body: source.slice(start.bodyStart, end.closeStart),
      start: start.start,
      end: end.closeEnd,
    });
    pos = end.closeEnd;
  }
  return out;
}

function findXmlStartTagOutsideCDATA(text, tag, from) {
  const lower = text.toLowerCase();
  const target = `<${tag}`;
  for (let i = Math.max(0, from || 0); i < text.length;) {
    const skipped = skipXmlIgnoredSection(text, i);
    if (skipped.blocked) {
      return null;
    }
    if (skipped.advanced) {
      i = skipped.next;
      continue;
    }
    if (lower.startsWith(target, i) && hasXmlTagBoundary(text, i + target.length)) {
      const tagEnd = findXmlTagEnd(text, i + target.length);
      if (tagEnd < 0) {
        return null;
      }
      return {
        start: i,
        bodyStart: tagEnd + 1,
        attrs: text.slice(i + target.length, tagEnd),
      };
    }
    i += 1;
  }
  return null;
}

function findMatchingXmlEndTagOutsideCDATA(text, tag, from) {
  const lower = text.toLowerCase();
  const openTarget = `<${tag}`;
  const closeTarget = `</${tag}`;
  let depth = 1;
  for (let i = Math.max(0, from || 0); i < text.length;) {
    const skipped = skipXmlIgnoredSection(text, i);
    if (skipped.blocked) {
      return null;
    }
    if (skipped.advanced) {
      i = skipped.next;
      continue;
    }
    if (lower.startsWith(closeTarget, i) && hasXmlTagBoundary(text, i + closeTarget.length)) {
      const tagEnd = findXmlTagEnd(text, i + closeTarget.length);
      if (tagEnd < 0) {
        return null;
      }
      depth -= 1;
      if (depth === 0) {
        return { closeStart: i, closeEnd: tagEnd + 1 };
      }
      i = tagEnd + 1;
      continue;
    }
    if (lower.startsWith(openTarget, i) && hasXmlTagBoundary(text, i + openTarget.length)) {
      const tagEnd = findXmlTagEnd(text, i + openTarget.length);
      if (tagEnd < 0) {
        return null;
      }
      if (!isSelfClosingXmlTag(text.slice(i, tagEnd))) {
        depth += 1;
      }
      i = tagEnd + 1;
      continue;
    }
    i += 1;
  }
  return null;
}

function skipXmlIgnoredSection(text, i) {
  const raw = toStringSafe(text);
  const openLen = toolCDATAOpenLenAt(raw, i);
  if (openLen > 0) {
    const end = findToolCDATAEnd(raw, i + openLen);
    if (end < 0) {
      return { advanced: false, blocked: true, next: i };
    }
    return { advanced: true, blocked: false, next: end + toolCDATACloseLenAt(raw, end) };
  }
  if (raw.startsWith('<!--', i)) {
    const end = raw.indexOf('-->', i + '<!--'.length);
    if (end < 0) {
      return { advanced: false, blocked: true, next: i };
    }
    return { advanced: true, blocked: false, next: end + '-->'.length };
  }
  return { advanced: false, blocked: false, next: i };
}

function findNextCDATAOpen(text, from) {
  const raw = toStringSafe(text);
  const start = indexToolCDATAOpen(raw, from || 0);
  if (start < 0) {
    return { ok: false, start: -1, bodyStart: -1 };
  }
  return { ok: true, start, bodyStart: start + toolCDATAOpenLenAt(raw, start) };
}

function matchCDATAOpenAt(text, start) {
  const raw = toStringSafe(text);
  const openLen = toolCDATAOpenLenAt(raw, start);
  return openLen > 0 ? { ok: true, bodyStart: start + openLen } : { ok: false, bodyStart: start };
}

function isCDATAOpenSeparator(ch) {
  return isToolMarkupSeparator(ch);
}

function findCDATAEnd(text, from) {
  const raw = toStringSafe(text);
  const index = findToolCDATAEnd(raw, from);
  return { index, len: index >= 0 ? toolCDATACloseLenAt(raw, index) : 0 };
}

function scanToolMarkupTagAt(text, start) {
  const raw = toStringSafe(text);
  const startDelimLen = xmlTagStartDelimiterLenAt(raw, start);
  if (!raw || start < 0 || start >= raw.length || !startDelimLen) {
    return null;
  }
  const lower = raw.toLowerCase();
  let i = start + startDelimLen;
  while (i < raw.length) {
    i = skipToolMarkupIgnorables(raw, i);
    const delimLen = xmlTagStartDelimiterLenAt(raw, i);
    if (!delimLen) {
      break;
    }
    i += delimLen;
  }
  const slash = consumeToolMarkupClosingSlash(raw, i);
  let closing = slash.closing;
  i = slash.next;
  const prefix = consumeToolMarkupNamePrefix(raw, lower, i);
  const prefixStart = i;
  i = prefix.next;
  let dsmlLike = prefix.dsmlLike;
  let { name, len } = matchToolMarkupName(raw, i, dsmlLike);
  if (!name) {
    const fallback = matchToolMarkupNameAfterArbitraryPrefix(raw, prefixStart);
    if (!fallback.ok) {
      return null;
    }
    if (!closing && toolMarkupPrefixContainsSlash(raw.slice(prefixStart, fallback.start))) {
      closing = true;
    }
    name = fallback.name;
    i = fallback.start;
    len = fallback.len;
    dsmlLike = true;
  }
  const originalNameEnd = i + len;
  let nameEnd = originalNameEnd;
  while (true) {
    const nextPipe = consumeToolMarkupSeparator(raw, nameEnd);
    if (!nextPipe.ok) {
      break;
    }
    nameEnd = nextPipe.next;
  }
  const hasTrailingSeparator = nameEnd > originalNameEnd;
  if (!hasXmlTagBoundary(raw, nameEnd)) {
    return null;
  }
  let end = findXmlTagEnd(raw, nameEnd);
  if (end < 0) {
    if (!hasTrailingSeparator) {
      return null;
    }
    end = nameEnd - 1;
  }
  if (hasTrailingSeparator) {
    const nextLT = raw.indexOf('<', nameEnd);
    if (nextLT >= 0 && end >= nextLT) {
      end = nameEnd - 1;
    }
  }
  if (end < 0) {
    return null;
  }
  return {
    start,
    end,
    nameStart: i,
    nameEnd,
    name,
    closing,
    selfClosing: isSelfClosingXmlTag(raw.slice(start, end)),
    dsmlLike,
    canonical: !dsmlLike,
  };
}

function findToolMarkupTagOutsideIgnored(text, from) {
  const raw = toStringSafe(text);
  for (let i = Math.max(0, from || 0); i < raw.length;) {
    const skipped = skipXmlIgnoredSection(raw, i);
    if (skipped.blocked) {
      return null;
    }
    if (skipped.advanced) {
      i = skipped.next;
      continue;
    }
    const spanEnd = markdownCodeSpanEnd(raw, i);
    if (spanEnd.ok) {
      i = spanEnd.end;
      continue;
    }
    const tag = scanToolMarkupTagAt(raw, i);
    if (tag) {
      return tag;
    }
    i += 1;
  }
  return null;
}

function findMatchingToolMarkupClose(text, openTag) {
  const raw = toStringSafe(text);
  if (!raw || !openTag || !openTag.name || openTag.closing) {
    return null;
  }
  let depth = 1;
  for (let pos = openTag.end + 1; pos < raw.length;) {
    const tag = findToolMarkupTagOutsideIgnored(raw, pos);
    if (!tag) {
      return null;
    }
    if (tag.name !== openTag.name) {
      pos = tag.end + 1;
      continue;
    }
    if (tag.closing) {
      depth -= 1;
      if (depth === 0) {
        return tag;
      }
    } else if (!tag.selfClosing) {
      depth += 1;
    }
    pos = tag.end + 1;
  }
  return null;
}

function findPartialToolMarkupStart(text) {
  const raw = toStringSafe(text);
  const lastLT = lastIndexOfToolMarkupStartDelimiter(raw);
  if (lastLT < 0) {
    return -1;
  }
  const start = includeDuplicateLeadingLessThan(raw, lastLT);
  const tail = raw.slice(start);
  if (containsXmlTagTerminator(tail)) {
    return -1;
  }
  return isPartialToolMarkupTagPrefix(tail) ? start : -1;
}

function includeDuplicateLeadingLessThan(text, idx) {
  let out = idx;
  while (out > 0 && isXmlTagStartDelimiter(text[out - 1])) {
    out -= 1;
  }
  return out;
}

function isXmlTagStartDelimiter(ch) {
  return ['<', '＜', '﹤', '〈'].includes(ch);
}

function isToolMarkupSeparator(ch) {
  if (isToolMarkupWhitespaceLike(ch)) {
    return false;
  }
  const normalized = normalizeFullwidthASCIIChar(ch || '');
  if (!normalized || ['<', '>', '/', '=', '"', "'", '['].includes(normalized)) {
    return false;
  }
  if ([' ', '\t', '\n', '\r'].includes(normalized)) {
    return false;
  }
  return !/^[A-Za-z0-9]$/.test(normalized);
}

function isToolMarkupWhitespaceLike(ch) {
  return !!ch && (/\s/u.test(ch) || ch === '▁');
}

function isPartialToolMarkupTagPrefix(text) {
  const raw = toStringSafe(text);
  if (!raw || !isXmlTagStartDelimiter(raw[0]) || containsXmlTagTerminator(raw)) {
    return false;
  }
  const lower = raw.toLowerCase();
  let i = 1;
  while (i < raw.length && isXmlTagStartDelimiter(raw[i])) {
    i += 1;
  }
  if (i >= raw.length) {
    return true;
  }
  const slash = consumeToolMarkupClosingSlash(raw, i);
  if (slash.closing) {
    i = slash.next;
  }
  while (i <= raw.length) {
    if (i === raw.length) {
      return true;
    }
    if (hasToolMarkupNamePrefix(raw, i)) {
      return true;
    }
    if (hasDSMLNamePrefixOrPartial(raw, i)) {
      return true;
    }
    if (hasPartialToolMarkupNameAfterArbitraryPrefix(raw, i)) {
      return true;
    }
    const next = consumeToolMarkupNamePrefixOnce(raw, lower, i);
    if (!next.ok) {
      return false;
    }
    i = next.next;
  }
  return false;
}

function consumeToolMarkupNamePrefix(raw, lower, idx) {
  let next = idx;
  let dsmlLike = false;
  while (true) {
    const consumed = consumeToolMarkupNamePrefixOnce(raw, lower, next);
    if (!consumed.ok) {
      return { next, dsmlLike };
    }
    next = consumed.next;
    dsmlLike = true;
  }
}

function matchToolMarkupNameAfterArbitraryPrefix(raw, start) {
  for (let idx = start; idx < raw.length;) {
    if (isToolMarkupTagTerminator(raw, idx)) {
      return { ok: false };
    }
    for (const name of TOOL_MARKUP_NAMES) {
      const matched = consumeToolKeyword(raw, idx, name.raw);
      if (!matched.ok) {
        continue;
      }
      if (!toolMarkupPrefixAllowsLocalNameAt(raw, start, idx)) {
        continue;
      }
      return { ok: true, name: name.canonical, start: idx, len: matched.next - idx };
    }
    idx += 1;
  }
  return { ok: false };
}

function hasPartialToolMarkupNameAfterArbitraryPrefix(raw, start) {
  for (let idx = start; idx < raw.length;) {
    if (isToolMarkupTagTerminator(raw, idx)) {
      return false;
    }
    if (toolMarkupPrefixAllowsLocalNameAt(raw, start, idx) && hasToolMarkupNamePrefix(raw, idx)) {
      return true;
    }
    if (toolMarkupPrefixAllowsLocalNameAt(raw, start, idx) && hasDSMLNamePrefixOrPartial(raw, idx)) {
      return true;
    }
    idx += 1;
  }
  return toolMarkupPrefixAllowsLocalName(raw.slice(start));
}

function hasDSMLNamePrefixOrPartial(raw, start) {
  const tail = normalizedASCIITailAt(raw, start);
  return tail.startsWith('dsml') || 'dsml'.startsWith(tail) || hasConfusablePartialKeywordPrefix(raw, start, 'dsml');
}

function toolMarkupPrefixAllowsLocalName(prefix) {
  if (!prefix) {
    return false;
  }
  if (normalizedASCIITailAt(prefix, 0).includes('dsml')) {
    return true;
  }
  if (/[="']/u.test(prefix)) {
    return false;
  }
  const previous = normalizeFullwidthASCIIChar(prefix[prefix.length - 1] || '');
  return !/^[A-Za-z0-9]$/.test(previous);
}

function toolMarkupPrefixAllowsLocalNameAt(raw, start, localStart) {
  if (start < 0 || localStart <= start || localStart > raw.length) {
    return false;
  }
  const prefix = raw.slice(start, localStart);
  if (toolMarkupPrefixAllowsLocalName(prefix)) {
    return true;
  }
  if (/[="']/u.test(prefix)) {
    return false;
  }
  const previous = normalizeFullwidthASCIIChar(prefix[prefix.length - 1] || '');
  const next = normalizeFullwidthASCIIChar(raw[localStart] || '');
  return /^[A-Za-z0-9]$/.test(previous) && /^[A-Z]$/.test(next);
}

function toolMarkupPrefixContainsSlash(prefix) {
  for (const ch of toStringSafe(prefix)) {
    if (normalizeFullwidthASCIIChar(ch) === '/') {
      return true;
    }
  }
  return false;
}

function isToolMarkupTagTerminator(raw, idx) {
  return raw[idx] === '>' || normalizeFullwidthASCIIChar(raw[idx] || '') === '>';
}

function consumeToolMarkupNamePrefixOnce(raw, lower, idx) {
  idx = skipToolMarkupIgnorables(raw, idx);
  const sep = consumeToolMarkupSeparator(raw, idx);
  if (sep.ok) {
    return sep;
  }
  const spacingLen = toolMarkupWhitespaceLikeLenAt(raw, idx);
  if (spacingLen > 0) {
    return { next: idx + spacingLen, ok: true };
  }
  const dsml = consumeToolKeyword(raw, idx, 'dsml');
  if (dsml.ok) {
    let next = dsml.next;
    const dashLen = toolMarkupDashLenAt(raw, next);
    const underscoreLen = toolMarkupUnderscoreLenAt(raw, next);
    if (dashLen) {
      next += dashLen;
    } else if (underscoreLen) {
      next += underscoreLen;
    }
    return { next, ok: true };
  }
  const arbitrary = consumeArbitraryToolMarkupNamePrefix(raw, lower, idx);
  if (arbitrary.ok) {
    return arbitrary;
  }
  return { next: idx, ok: false };
}

function consumeArbitraryToolMarkupNamePrefix(raw, _lower, idx) {
  const first = consumeToolMarkupPrefixSegment(raw, idx);
  if (!first.ok) {
    return { next: idx, ok: false };
  }
  let j = first.next;
  while (j < raw.length) {
    const segment = consumeToolMarkupPrefixSegment(raw, j);
    if (!segment.ok) {
      break;
    }
    j = segment.next;
  }
  let k = j;
  while (true) {
    const spacingLen = toolMarkupWhitespaceLikeLenAt(raw, k);
    if (!spacingLen) {
      break;
    }
    k += spacingLen;
  }
  let next = k;
  let ok = false;
  const sep = consumeToolMarkupSeparator(raw, next);
  if (sep.ok) {
    next = sep.next;
    ok = true;
  } else {
    const dashLen = toolMarkupDashLenAt(raw, next);
    const underscoreLen = toolMarkupUnderscoreLenAt(raw, next);
    if (dashLen) {
      next += dashLen;
      ok = true;
    } else if (underscoreLen) {
      next += underscoreLen;
      ok = true;
    }
  }
  if (!ok) {
    return { next: idx, ok: false };
  }
  while (true) {
    const spacingLen = toolMarkupWhitespaceLikeLenAt(raw, next);
    if (!spacingLen) {
      break;
    }
    next += spacingLen;
  }
  if (!hasToolMarkupNamePrefix(raw, next)) {
    return { next: idx, ok: false };
  }
  return { next, ok: true };
}

function consumeToolMarkupPrefixSegment(raw, idx) {
  if (idx < 0 || idx >= raw.length) {
    return { next: idx, ok: false };
  }
  const normalized = normalizeFullwidthASCIIChar(raw[idx]);
  if (/^[A-Za-z0-9]$/.test(normalized)) {
    return { next: idx + 1, ok: true };
  }
  return { next: idx, ok: false };
}

function hasToolMarkupNamePrefix(raw, start) {
  for (const name of TOOL_MARKUP_NAMES) {
    if (consumeToolKeyword(raw, start, name.raw).ok) {
      return true;
    }
    if (hasConfusablePartialKeywordPrefix(raw, start, name.raw)) {
      return true;
    }
  }
  return false;
}

function hasConfusablePartialKeywordPrefix(raw, start, keyword) {
  if (start < 0 || start >= raw.length) {
    return false;
  }
  let idx = start;
  let matched = 0;
  while (matched < keyword.length && idx < raw.length) {
    idx = skipToolMarkupIgnorables(raw, idx);
    if (idx >= raw.length) {
      break;
    }
    const expected = keyword[matched];
    if (expected === '_') {
      const underscoreLen = toolMarkupUnderscoreLenAt(raw, idx);
      if (!underscoreLen) {
        return false;
      }
      idx += underscoreLen;
      matched += 1;
      continue;
    }
    if (expected === '-') {
      const dashLen = toolMarkupDashLenAt(raw, idx);
      if (!dashLen) {
        return false;
      }
      idx += dashLen;
      matched += 1;
      continue;
    }
    const cp = raw.codePointAt(idx);
    const ch = String.fromCodePoint(cp);
    const folded = foldToolKeywordRune(ch);
    if (!folded || folded !== expected.toLowerCase()) {
      return false;
    }
    idx += ch.length;
    matched += 1;
  }
  return matched > 0 && matched < keyword.length && idx === raw.length;
}

function matchToolMarkupName(raw, start, dsmlLike) {
  for (const name of TOOL_MARKUP_NAMES) {
    if (name.dsmlOnly && !dsmlLike) {
      continue;
    }
    const matched = consumeToolKeyword(raw, start, name.raw);
    if (matched.ok) {
      return { name: name.canonical, len: matched.next - start };
    }
  }
  return { name: '', len: 0 };
}

function consumeToolMarkupSeparator(raw, idx) {
  idx = skipToolMarkupIgnorables(raw, idx);
  if (idx >= raw.length) {
    return { next: idx, ok: false };
  }
  const cp = raw.codePointAt(idx);
  const ch = String.fromCodePoint(cp);
  if (!isToolMarkupSeparator(ch)) {
    return { next: idx, ok: false };
  }
  return { next: idx + ch.length, ok: true };
}

function hasToolMarkupBoundary(text, idx) {
  idx = skipToolMarkupIgnorables(text, idx);
  if (idx >= text.length) {
    return true;
  }
  if (toolMarkupWhitespaceLikeLenAt(text, idx) > 0) {
    return true;
  }
  if (consumeToolMarkupClosingSlash(text, idx).closing) {
    return true;
  }
  return xmlTagEndDelimiterLenAt(text, idx) > 0;
}

function consumeToolMarkupLessThan(raw, idx) {
  idx = skipToolMarkupIgnorables(raw, idx);
  if (idx < 0 || idx >= raw.length) {
    return { next: idx, ok: false };
  }
  const delimLen = xmlTagStartDelimiterLenAt(raw, idx);
  if (!delimLen) {
    return { next: idx, ok: false };
  }
  return { next: idx + delimLen, ok: true };
}

function canonicalizeToolCallCandidateSpans(text) {
  const raw = toStringSafe(text);
  if (!raw) {
    return '';
  }
  let out = '';
  for (let i = 0; i < raw.length;) {
    const skipped = skipXmlIgnoredSection(raw, i);
    if (skipped.blocked) {
      out += raw.slice(i);
      break;
    }
    if (skipped.advanced) {
      out += raw.slice(i, skipped.next);
      i = skipped.next;
      continue;
    }
    const spanEnd = markdownCodeSpanEnd(raw, i);
    if (spanEnd.ok) {
      out += raw.slice(i, spanEnd.end);
      i = spanEnd.end;
      continue;
    }
    const tag = scanToolMarkupTagAt(raw, i);
    if (!tag) {
      out += raw[i];
      i += 1;
      continue;
    }
    out += canonicalizeRecognizedToolMarkupTag(raw.slice(tag.start, tag.end + 1), tag);
    i = tag.end + 1;
  }
  return out;
}

function canonicalizeRecognizedToolMarkupTag(rawTag, tag) {
  const raw = toStringSafe(rawTag);
  if (!raw || !tag) {
    return raw;
  }
  let idx = 0;
  const startLen = xmlTagStartDelimiterLenAt(raw, idx);
  if (startLen > 0) {
    idx += startLen;
  }
  while (idx < raw.length) {
    idx = skipToolMarkupIgnorables(raw, idx);
    const delimLen = xmlTagStartDelimiterLenAt(raw, idx);
    if (!delimLen) {
      break;
    }
    idx += delimLen;
  }
  idx = skipToolMarkupIgnorables(raw, idx);
  if (tag.closing) {
    const slash = consumeToolMarkupClosingSlash(raw, idx);
    if (slash.closing) {
      idx = slash.next;
    }
  }
  const prefix = consumeToolMarkupNamePrefix(raw, raw.toLowerCase(), idx);
  idx = prefix.next;
  const nameMatch = consumeToolKeyword(raw, idx, rawNameForTag(tag));
  const afterName = nameMatch.ok ? nameMatch.next : idx;
  const attrs = parseCanonicalToolMarkupAttrs(raw, afterName);

  let out = '<';
  if (tag.closing) {
    out += '/';
  }
  if (tag.dsmlLike) {
    out += '|DSML|';
  }
  out += tag.name;
  for (const attr of attrs) {
    if (!attr || !attr.key) {
      continue;
    }
    out += ` ${attr.key}="${quoteCanonicalXMLAttrValue(attr.value)}"`;
  }
  if (tag.selfClosing) {
    out += '/';
  }
  out += '>';
  return out;
}

function parseCanonicalToolMarkupAttrs(rawTag, startIdx) {
  const raw = toStringSafe(rawTag);
  let idx = Math.max(0, startIdx || 0);
  const out = [];
  while (idx < raw.length) {
    idx = skipToolMarkupIgnorables(raw, idx);
    if (idx >= raw.length) {
      break;
    }
    const spacingLen = toolMarkupWhitespaceLikeLenAt(raw, idx);
    if (spacingLen > 0) {
      idx += spacingLen;
      continue;
    }
    if (xmlTagEndDelimiterLenAt(raw, idx) > 0) {
      break;
    }
    if (consumeToolMarkupPipe(raw, idx).ok) {
      idx = consumeToolMarkupPipe(raw, idx).next;
      continue;
    }
    if (consumeToolMarkupClosingSlash(raw, idx).closing) {
      idx = consumeToolMarkupClosingSlash(raw, idx).next;
      continue;
    }

    const keyStart = idx;
    while (idx < raw.length) {
      idx = skipToolMarkupIgnorables(raw, idx);
      if (idx >= raw.length) {
        break;
      }
      if (toolMarkupWhitespaceLikeLenAt(raw, idx) > 0) {
        break;
      }
      if (toolMarkupEqualsLenAt(raw, idx) > 0 || xmlTagEndDelimiterLenAt(raw, idx) > 0) {
        break;
      }
      if (consumeToolMarkupPipe(raw, idx).ok || consumeToolMarkupClosingSlash(raw, idx).closing) {
        break;
      }
      const cp = raw.codePointAt(idx);
      idx += cp > 0xFFFF ? 2 : 1;
    }
    const key = normalizeCanonicalToolAttrKey(raw.slice(keyStart, idx));

    idx = skipToolMarkupIgnorables(raw, idx);
    while (idx < raw.length) {
      const wsLen = toolMarkupWhitespaceLikeLenAt(raw, idx);
      if (!wsLen) {
        break;
      }
      idx += wsLen;
      idx = skipToolMarkupIgnorables(raw, idx);
    }
    const equalsLen = toolMarkupEqualsLenAt(raw, idx);
    if (!equalsLen) {
      continue;
    }
    idx += equalsLen;
    idx = skipToolMarkupIgnorables(raw, idx);
    while (idx < raw.length) {
      const wsLen = toolMarkupWhitespaceLikeLenAt(raw, idx);
      if (!wsLen) {
        break;
      }
      idx += wsLen;
      idx = skipToolMarkupIgnorables(raw, idx);
    }
    if (!key) {
      if (idx < raw.length) {
        const cp = raw.codePointAt(idx);
        idx += cp > 0xFFFF ? 2 : 1;
      }
      continue;
    }

    let value = '';
    const quote = xmlQuotePairAt(raw, idx);
    if (quote.len) {
      const valueStart = idx + quote.len;
      idx = valueStart;
      while (idx < raw.length) {
        const closeLen = xmlQuoteCloseDelimiterLenAt(raw, idx, quote.close);
        if (closeLen) {
          value = raw.slice(valueStart, idx);
          idx += closeLen;
          break;
        }
        const cp = raw.codePointAt(idx);
        idx += cp > 0xFFFF ? 2 : 1;
      }
    } else {
      const valueStart = idx;
      while (idx < raw.length) {
        if (toolMarkupWhitespaceLikeLenAt(raw, idx) > 0 || xmlTagEndDelimiterLenAt(raw, idx) > 0 || toolMarkupEqualsLenAt(raw, idx) > 0) {
          break;
        }
        if (consumeToolMarkupPipe(raw, idx).ok || consumeToolMarkupClosingSlash(raw, idx).closing) {
          break;
        }
        const cp = raw.codePointAt(idx);
        idx += cp > 0xFFFF ? 2 : 1;
      }
      value = raw.slice(valueStart, idx);
    }
    out.push({ key, value });
  }
  return out;
}

function normalizeCanonicalToolAttrKey(rawKey) {
  const trimmed = toStringSafe(removeToolMarkupIgnorables(rawKey)).trim();
  if (!trimmed) {
    return '';
  }
  const matched = consumeToolKeyword(trimmed, 0, 'name');
  return matched.ok && skipToolMarkupIgnorables(trimmed, matched.next) === trimmed.length ? 'name' : '';
}

function quoteCanonicalXMLAttrValue(rawValue) {
  return toStringSafe(rawValue).replace(/"/g, '&quot;');
}

function removeToolMarkupIgnorables(rawValue) {
  const raw = toStringSafe(rawValue);
  let out = '';
  for (let i = 0; i < raw.length;) {
    const ignorableLen = toolMarkupIgnorableLenAt(raw, i);
    if (ignorableLen) {
      i += ignorableLen;
      continue;
    }
    const cp = raw.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    out += ch;
    i += ch.length;
  }
  return out;
}

function skipToolMarkupIgnorables(text, idx) {
  const raw = toStringSafe(text);
  let pos = Math.max(0, idx || 0);
  while (pos < raw.length) {
    const next = toolMarkupIgnorableLenAt(raw, pos);
    if (!next) {
      break;
    }
    pos += next;
  }
  return pos;
}

function toolMarkupIgnorableLenAt(text, idx) {
  const raw = toStringSafe(text);
  if (idx < 0 || idx >= raw.length) {
    return 0;
  }
  const cp = raw.codePointAt(idx);
  if (cp === undefined) {
    return 0;
  }
  const ch = String.fromCodePoint(cp);
  const isFormat = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFE00-\uFE0F\uFEFF]/u.test(ch);
  const isControl = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(ch);
  return isFormat || isControl ? ch.length : 0;
}

function toolMarkupEqualsLenAt(text, idx) {
  const raw = toStringSafe(text);
  const pos = skipToolMarkupIgnorables(raw, idx);
  for (const variant of ['=', '＝', '﹦', '꞊']) {
    if (raw.startsWith(variant, pos)) {
      return (pos + variant.length) - idx;
    }
  }
  return 0;
}

function toolMarkupDashLenAt(text, idx) {
  const raw = toStringSafe(text);
  const pos = skipToolMarkupIgnorables(raw, idx);
  for (const variant of ['-', '‐', '‑', '‒', '–', '—', '―', '−', '﹣', '－']) {
    if (raw.startsWith(variant, pos)) {
      return (pos + variant.length) - idx;
    }
  }
  return 0;
}

function toolMarkupUnderscoreLenAt(text, idx) {
  const raw = toStringSafe(text);
  const pos = skipToolMarkupIgnorables(raw, idx);
  for (const variant of ['_', '＿', '﹍', '﹎', '﹏']) {
    if (raw.startsWith(variant, pos)) {
      return (pos + variant.length) - idx;
    }
  }
  return 0;
}

function consumeToolKeyword(text, idx, keyword) {
  const raw = toStringSafe(text);
  let next = idx;
  for (const ch of keyword.toLowerCase()) {
    next = skipToolMarkupIgnorables(raw, next);
    if (next >= raw.length) {
      return { next: idx, ok: false };
    }
    if (ch === '_') {
      const len = toolMarkupUnderscoreLenAt(raw, next);
      if (!len) {
        return { next: idx, ok: false };
      }
      next += len;
      continue;
    }
    if (ch === '-') {
      const len = toolMarkupDashLenAt(raw, next);
      if (!len) {
        return { next: idx, ok: false };
      }
      next += len;
      continue;
    }
    const cp = raw.codePointAt(next);
    const folded = foldToolKeywordRune(String.fromCodePoint(cp));
    if (!folded || folded !== ch) {
      return { next: idx, ok: false };
    }
    next += cp > 0xFFFF ? 2 : 1;
  }
  return { next, ok: true };
}

function foldToolKeywordRune(ch) {
  if (!ch) {
    return '';
  }
  const cp = ch.codePointAt(0);
  if (cp >= 0xFF21 && cp <= 0xFF3A) {
    return String.fromCharCode(cp - 0xFEE0).toLowerCase();
  }
  if (cp >= 0xFF41 && cp <= 0xFF5A) {
    return String.fromCharCode(cp - 0xFEE0);
  }
  const lower = ch.toLowerCase();
  if ('acdeiklmnoprstv'.includes(lower)) {
    return lower;
  }
  const mapped = {
    'а': 'a',
    'α': 'a',
    'с': 'c',
    'ϲ': 'c',
    'ԁ': 'd',
    'ⅾ': 'd',
    'е': 'e',
    'ε': 'e',
    'і': 'i',
    'ι': 'i',
    'ı': 'i',
    'к': 'k',
    'κ': 'k',
    'ⅼ': 'l',
    'м': 'm',
    'μ': 'm',
    'ո': 'n',
    'о': 'o',
    'ο': 'o',
    'р': 'p',
    'ρ': 'p',
    'ѕ': 's',
    'т': 't',
    'τ': 't',
    'ν': 'v',
    'ѵ': 'v',
    'ⅴ': 'v',
  };
  return mapped[lower] || '';
}

function toolMarkupWhitespaceLikeLenAt(text, idx) {
  const raw = toStringSafe(text);
  const pos = skipToolMarkupIgnorables(raw, idx);
  if (pos < 0 || pos >= raw.length) {
    return 0;
  }
  if ([' ', '\t', '\n', '\r'].includes(raw[pos])) {
    return (pos + 1) - idx;
  }
  if (raw.startsWith('▁', pos)) {
    return (pos + '▁'.length) - idx;
  }
  const cp = raw.codePointAt(pos);
  const ch = String.fromCodePoint(cp);
  return /\s/u.test(ch) ? (pos + ch.length) - idx : 0;
}

function consumeToolMarkupPipe(raw, idx) {
  const pos = skipToolMarkupIgnorables(raw, idx);
  if (pos >= raw.length) {
    return { next: idx, ok: false };
  }
  for (const variant of ['|', '│', '∣', '❘', 'ǀ', '￨']) {
    if (raw.startsWith(variant, pos)) {
      return { next: pos + variant.length, ok: true };
    }
  }
  return { next: idx, ok: false };
}

function consumeToolMarkupClosingSlash(raw, idx) {
  const pos = skipToolMarkupIgnorables(raw, idx);
  if (pos >= raw.length) {
    return { next: idx, closing: false };
  }
  for (const variant of ['/', '／', '∕', '⁄', '⧸']) {
    if (raw.startsWith(variant, pos)) {
      return { next: pos + variant.length, closing: true };
    }
  }
  return { next: idx, closing: false };
}

function xmlTagStartDelimiterLenAt(text, idx) {
  const raw = toStringSafe(text);
  const pos = skipToolMarkupIgnorables(raw, idx);
  if (pos < 0 || pos >= raw.length) {
    return 0;
  }
  for (const variant of ['<', '＜', '﹤', '〈']) {
    if (raw.startsWith(variant, pos)) {
      return (pos + variant.length) - idx;
    }
  }
  return 0;
}

function xmlTagEndDelimiterLenAt(text, idx) {
  const raw = toStringSafe(text);
  const pos = skipToolMarkupIgnorables(raw, idx);
  if (pos < 0 || pos >= raw.length) {
    return 0;
  }
  for (const variant of ['>', '＞', '﹥', '〉']) {
    if (raw.startsWith(variant, pos)) {
      return (pos + variant.length) - idx;
    }
  }
  return 0;
}

function xmlTagEndDelimiterLenEndingAt(text, end) {
  const raw = toStringSafe(text);
  if (end < 0 || end >= raw.length) {
    return 0;
  }
  for (const variant of ['>', '＞', '﹥', '〉']) {
    if (end + 1 >= variant.length && raw.slice(end + 1 - variant.length, end + 1) === variant) {
      return variant.length;
    }
  }
  return 0;
}

function xmlQuotePairAt(text, idx) {
  const raw = toStringSafe(text);
  const pos = skipToolMarkupIgnorables(raw, idx);
  if (pos < 0 || pos >= raw.length) {
    return { close: '', len: 0 };
  }
  if (raw[pos] === '"') {
    return { close: '"', len: (pos + 1) - idx };
  }
  if (raw[pos] === "'") {
    return { close: "'", len: (pos + 1) - idx };
  }
  if (raw.startsWith('“', pos)) {
    return { close: '”', len: (pos + '“'.length) - idx };
  }
  if (raw.startsWith('‘', pos)) {
    return { close: '’', len: (pos + '‘'.length) - idx };
  }
  if (raw.startsWith('＂', pos)) {
    return { close: '＂', len: (pos + '＂'.length) - idx };
  }
  if (raw.startsWith('＇', pos)) {
    return { close: '＇', len: (pos + '＇'.length) - idx };
  }
  if (raw.startsWith('„', pos)) {
    return { close: '”', len: (pos + '„'.length) - idx };
  }
  if (raw.startsWith('‟', pos)) {
    return { close: '”', len: (pos + '‟'.length) - idx };
  }
  return { close: '', len: 0 };
}

function xmlQuoteCloseDelimiterLenAt(text, idx, close) {
  const raw = toStringSafe(text);
  if (!close) {
    return 0;
  }
  return raw.startsWith(close, idx) ? close.length : 0;
}

function lastIndexOfToolMarkupStartDelimiter(raw) {
  const text = toStringSafe(raw);
  let best = -1;
  for (const variant of ['<', '＜', '﹤', '〈']) {
    const idx = text.lastIndexOf(variant);
    if (idx > best) {
      best = idx;
    }
  }
  return best;
}

function containsXmlTagTerminator(raw) {
  const text = toStringSafe(raw);
  return text.includes('>') || text.includes('＞') || text.includes('﹥') || text.includes('〉');
}

function findXmlTagEnd(text, from) {
  const raw = toStringSafe(text);
  let quote = '';
  for (let i = Math.max(0, from || 0); i < raw.length;) {
    if (quote) {
      const closeLen = xmlQuoteCloseDelimiterLenAt(raw, i, quote);
      if (closeLen) {
        quote = '';
        i += closeLen;
        continue;
      }
      const cp = raw.codePointAt(i);
      i += cp > 0xFFFF ? 2 : 1;
      continue;
    }
    const nextQuote = xmlQuotePairAt(raw, i);
    if (nextQuote.len) {
      quote = nextQuote.close;
      i += nextQuote.len;
      continue;
    }
    const endLen = xmlTagEndDelimiterLenAt(raw, i);
    if (endLen > 0) {
      return i + endLen - 1;
    }
    const cp = raw.codePointAt(i);
    i += cp > 0xFFFF ? 2 : 1;
  }
  return -1;
}

function hasXmlTagBoundary(text, idx) {
  const pos = skipToolMarkupIgnorables(text, idx);
  if (pos >= text.length) {
    return true;
  }
  return toolMarkupWhitespaceLikeLenAt(text, pos) > 0
    || consumeToolMarkupClosingSlash(text, pos).closing
    || xmlTagEndDelimiterLenAt(text, pos) > 0;
}

function isSelfClosingXmlTag(startTag) {
  const trimmed = toStringSafe(startTag).trim();
  return trimmed.endsWith('/') || trimmed.endsWith('／');
}

function normalizeFullwidthASCIIChar(ch) {
  if (!ch) {
    return ch;
  }
  if (ch === '〈') {
    return '<';
  }
  if (ch === '〉') {
    return '>';
  }
  if (ch === '“' || ch === '”') {
    return '"';
  }
  if (ch === '‘' || ch === '’') {
    return "'";
  }
  const code = ch.charCodeAt(0);
  if (code >= 0xff01 && code <= 0xff5e) {
    return String.fromCharCode(code - 0xfee0);
  }
  return ch;
}

function normalizedASCIITailAt(raw, start) {
  let out = '';
  for (let i = Math.max(0, start || 0); i < raw.length; i += 1) {
    const ch = normalizeFullwidthASCIIChar(raw[i]).toLowerCase();
    if (ch.charCodeAt(0) > 0x7f) {
      break;
    }
    out += ch;
  }
  return out;
}

function matchNormalizedASCII(raw, start, expected) {
  let idx = start;
  for (let j = 0; j < expected.length; j += 1) {
    if (idx >= raw.length) {
      return { ok: false, len: 0 };
    }
    const ch = normalizeFullwidthASCIIChar(raw[idx]).toLowerCase();
    if (ch !== expected[j].toLowerCase()) {
      return { ok: false, len: 0 };
    }
    idx += 1;
  }
  return { ok: true, len: idx - start };
}

function normalizeToolMarkupTagTailForXML(tail) {
  let out = '';
  const raw = typeof tail === 'string' ? tail : String(tail || '');
  let quote = '';
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    const normalized = normalizeFullwidthASCIIChar(ch);
    if (quote) {
      out += normalized;
      if (normalized === quote) {
        quote = '';
      }
    } else if (normalized === '"' || normalized === "'") {
      quote = normalized;
      out += normalized;
    } else if (normalized === '|' || normalized === '!') {
      let j = i + 1;
      while (j < raw.length && [' ', '\t', '\r', '\n'].includes(raw[j])) {
        j += 1;
      }
      if (normalizeFullwidthASCIIChar(raw[j] || '') !== '>') {
        out += normalized;
      }
    } else if (['>', '/', '='].includes(normalized)) {
      out += normalized;
    } else {
      out += ch;
    }
  }
  return out;
}

function parseMarkupInput(raw) {
  const s = toStringSafe(raw).trim();
  if (!s) {
    return {};
  }
  // Prioritize XML-style KV tags (e.g., <arg>val</arg>)
  const kv = unwrapItemOnlyMarkupValue(parseMarkupKVObject(s));
  if (Array.isArray(kv)) {
    return kv;
  }
  if (kv && typeof kv === 'object' && Object.keys(kv).length > 0) {
    return kv;
  }

  // Fallback to JSON parsing
  const parsed = parseToolCallInput(s);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    if (Object.keys(parsed).length > 0) {
      return parsed;
    }
  }

  return { _raw: extractRawTagValue(s) };
}

function parseMarkupKVObject(text) {
  const raw = toStringSafe(text).trim();
  if (!raw) {
    return {};
  }
  const out = {};
  for (const block of findGenericXmlElementBlocks(raw)) {
    const key = toStringSafe(block.localName).trim();
    if (!key) {
      continue;
    }
    const value = parseMarkupValue(block.body, key);
    if (value === undefined || value === null) {
      continue;
    }
    appendMarkupValue(out, key, value);
  }
  return out;
}

function findGenericXmlElementBlocks(text) {
  const source = toStringSafe(text);
  if (!source) {
    return [];
  }
  const out = [];
  let pos = 0;
  while (pos < source.length) {
    const start = findGenericXmlStartTagOutsideCDATA(source, pos);
    if (!start) {
      break;
    }
    if (start.selfClosing) {
      out.push({
        name: start.name,
        localName: start.localName,
        attrs: start.attrs,
        body: '',
        start: start.start,
        end: start.end + 1,
      });
      pos = start.end + 1;
      continue;
    }
    const end = findMatchingGenericXmlEndTagOutsideCDATA(source, start.name, start.bodyStart);
    if (!end) {
      pos = start.bodyStart;
      continue;
    }
    out.push({
      name: start.name,
      localName: start.localName,
      attrs: start.attrs,
      body: source.slice(start.bodyStart, end.closeStart),
      start: start.start,
      end: end.closeEnd,
    });
    pos = end.closeEnd;
  }
  return out;
}

function findGenericXmlStartTagOutsideCDATA(text, from) {
  const lower = text.toLowerCase();
  for (let i = Math.max(0, from || 0); i < text.length;) {
    const skipped = skipXmlIgnoredSection(text, i);
    if (skipped.blocked) {
      return null;
    }
    if (skipped.advanced) {
      i = skipped.next;
      continue;
    }
    if (text[i] !== '<' || text[i + 1] === '/' || text[i + 1] === '!' || text[i + 1] === '?') {
      i += 1;
      continue;
    }
    const match = text.slice(i + 1).match(/^([A-Za-z_][A-Za-z0-9_.:-]*)/);
    if (!match) {
      i += 1;
      continue;
    }
    const name = match[1];
    const nameEnd = i + 1 + name.length;
    if (!hasXmlTagBoundary(text, nameEnd)) {
      i += 1;
      continue;
    }
    const tagEnd = findXmlTagEnd(text, nameEnd);
    if (tagEnd < 0) {
      return null;
    }
    return {
      start: i,
      end: tagEnd,
      bodyStart: tagEnd + 1,
      name,
      localName: name.includes(':') ? name.slice(name.lastIndexOf(':') + 1) : name,
      attrs: text.slice(nameEnd, tagEnd),
      selfClosing: isSelfClosingXmlTag(text.slice(i, tagEnd)),
    };
  }
  return null;
}

function findMatchingGenericXmlEndTagOutsideCDATA(text, name, from) {
  const lower = text.toLowerCase();
  const needle = toStringSafe(name).toLowerCase();
  if (!needle) {
    return null;
  }
  const openTarget = `<${needle}`;
  const closeTarget = `</${needle}`;
  let depth = 1;
  for (let i = Math.max(0, from || 0); i < text.length;) {
    const skipped = skipXmlIgnoredSection(text, i);
    if (skipped.blocked) {
      return null;
    }
    if (skipped.advanced) {
      i = skipped.next;
      continue;
    }
    if (lower.startsWith(closeTarget, i) && hasXmlTagBoundary(text, i + closeTarget.length)) {
      const tagEnd = findXmlTagEnd(text, i + closeTarget.length);
      if (tagEnd < 0) {
        return null;
      }
      depth -= 1;
      if (depth === 0) {
        return { closeStart: i, closeEnd: tagEnd + 1 };
      }
      i = tagEnd + 1;
      continue;
    }
    if (lower.startsWith(openTarget, i) && hasXmlTagBoundary(text, i + openTarget.length)) {
      const tagEnd = findXmlTagEnd(text, i + openTarget.length);
      if (tagEnd < 0) {
        return null;
      }
      if (!isSelfClosingXmlTag(text.slice(i, tagEnd))) {
        depth += 1;
      }
      i = tagEnd + 1;
      continue;
    }
    i += 1;
  }
  return null;
}

function parseMarkupValue(raw, paramName = '') {
  const cdata = extractStandaloneCDATA(raw);
  if (cdata.ok) {
    const literal = parseJSONLiteralValue(cdata.value);
    if (literal.ok) {
      const literalArray = coerceArrayValue(literal.value, paramName);
      if (literalArray.ok) {
        return literalArray.value;
      }
      return literal.value;
    }
    const structured = parseStructuredCDATAParameterValue(paramName, cdata.value);
    if (structured.ok) {
      return structured.value;
    }
    const looseArray = parseLooseJSONArrayValue(cdata.value, paramName);
    return looseArray.ok ? looseArray.value : cdata.value;
  }
  const s = toStringSafe(extractRawTagValue(raw)).trim();
  if (!s) {
    return '';
  }

  if (s.includes('<') && s.includes('>')) {
    const nested = unwrapItemOnlyMarkupValue(parseMarkupInput(s));
    if (Array.isArray(nested)) {
      return nested;
    }
    if (nested && typeof nested === 'object') {
      const nestedArray = coerceArrayValue(nested, paramName);
      if (nestedArray.ok) {
        return nestedArray.value;
      }
      if (isOnlyRawValue(nested)) {
        const rawValue = toStringSafe(nested._raw);
        const looseArray = parseLooseJSONArrayValue(rawValue, paramName);
        return looseArray.ok ? looseArray.value : rawValue;
      }
      return nested;
    }
  }

  const literal = parseJSONLiteralValue(s);
  if (literal.ok) {
    const literalArray = coerceArrayValue(literal.value, paramName);
    if (literalArray.ok) {
      return literalArray.value;
    }
    return literal.value;
  }
  const looseArray = parseLooseJSONArrayValue(s, paramName);
  if (looseArray.ok) {
    return looseArray.value;
  }
  return s;
}

function parseStructuredCDATAParameterValue(paramName, raw) {
  if (preservesCDATAStringParameter(paramName)) {
    return { ok: false, value: null };
  }
  const normalized = normalizeCDATAForStructuredParse(raw);
  if (!normalized.includes('<') || !normalized.includes('>')) {
    return { ok: false, value: null };
  }
  if (!cdataFragmentLooksExplicitlyStructured(normalized)) {
    return { ok: false, value: null };
  }
  const parsed = parseMarkupInput(normalized);
  if (Array.isArray(parsed)) {
    return { ok: true, value: parsed };
  }
  if (parsed && typeof parsed === 'object' && !isOnlyRawValue(parsed) && Object.keys(parsed).length > 0) {
    return { ok: true, value: parsed };
  }
  return { ok: false, value: null };
}

function normalizeCDATAForStructuredParse(raw) {
  return unescapeHtml(toStringSafe(raw).replace(/<br\s*\/?>/gi, '\n').trim());
}

function cdataFragmentLooksExplicitlyStructured(raw) {
  const blocks = findGenericXmlElementBlocks(raw);
  if (blocks.length === 0) {
    return false;
  }
  if (blocks.length > 1) {
    return true;
  }
  const block = blocks[0];
  if (toStringSafe(block.localName).trim().toLowerCase() === 'item') {
    return true;
  }
  return findGenericXmlElementBlocks(block.body).length > 0;
}

function preservesCDATAStringParameter(name) {
  return new Set([
    'content',
    'file_content',
    'text',
    'prompt',
    'query',
    'command',
    'cmd',
    'script',
    'code',
    'old_string',
    'new_string',
    'pattern',
    'path',
    'file_path',
  ]).has(toStringSafe(name).trim().toLowerCase());
}

function unwrapItemOnlyMarkupValue(value) {
  if (Array.isArray(value)) {
    return value.map(unwrapItemOnlyMarkupValue);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === 'item') {
    const items = unwrapItemOnlyMarkupValue(value.item);
    return Array.isArray(items) ? items : [items];
  }
  const out = {};
  for (const key of keys) {
    out[key] = unwrapItemOnlyMarkupValue(value[key]);
  }
  return out;
}

function extractRawTagValue(inner) {
  const s = toStringSafe(inner).trim();
  if (!s) {
    return '';
  }

  // 1. Check for CDATA
  const cdata = extractStandaloneCDATA(s);
  if (cdata.ok) {
    return cdata.value;
  }

  // 2. Fallback to unescaping standard HTML entities
  // Note: we avoid broad tag stripping here to preserve user content (like < symbols in code)
  return unescapeHtml(inner);
}

function unescapeHtml(safe) {
  if (!safe) return '';
  return safe.replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'");
}

function extractStandaloneCDATA(inner) {
  const s = toStringSafe(inner).trim();
  const openLen = toolCDATAOpenLenAt(s, 0);
  if (!openLen) {
    return { ok: false, value: '' };
  }
  const closeStart = findTrailingToolCDATACloseStart(s);
  if (closeStart >= openLen) {
    return { ok: true, value: s.slice(openLen, closeStart) };
  }
  const end = findToolCDATAEnd(s, openLen);
  if (end >= 0) {
    return { ok: true, value: s.slice(openLen, end) };
  }
  return { ok: true, value: s.slice(openLen) };
}

function findStandaloneCDATAEnd(text, from) {
  const raw = toStringSafe(text);
  let best = { index: -1, len: 0 };
  for (let searchFrom = Math.max(0, from || 0); searchFrom < raw.length;) {
    const index = findToolCDATAEnd(raw, searchFrom);
    if (index < 0) {
      break;
    }
    const len = toolCDATACloseLenAt(raw, index);
    const closeEnd = index + len;
    if (!raw.slice(closeEnd).trim()) {
      best = { index, len };
    }
    searchFrom = closeEnd;
  }
  return best;
}

function parseJSONLiteralValue(raw) {
  const s = toStringSafe(raw).trim();
  if (!s) {
    return { ok: false, value: null };
  }
  if (!['{', '[', '"', '-', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 't', 'f', 'n'].includes(s[0])) {
    return { ok: false, value: null };
  }
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch (_err) {
    return { ok: false, value: null };
  }
}

function parseLooseJSONArrayValue(raw, paramName = '') {
  if (preservesCDATAStringParameter(paramName)) {
    return { ok: false, value: null };
  }
  const s = toStringSafe(raw).trim();
  if (!s) {
    return { ok: false, value: null };
  }
  const candidate = parseLooseJSONArrayCandidate(s, paramName);
  if (candidate.ok) {
    return candidate;
  }

  const segments = splitTopLevelJSONValues(s);
  if (segments.length < 2) {
    return { ok: false, value: null };
  }

  const out = [];
  for (const segment of segments) {
    const parsed = parseLooseArrayElementValue(segment);
    if (!parsed.ok) {
      return { ok: false, value: null };
    }
    out.push(parsed.value);
  }
  return { ok: true, value: out };
}

function parseLooseJSONArrayCandidate(raw, paramName = '') {
  const parsed = parseLooseArrayElementValue(raw);
  if (!parsed.ok) {
    return { ok: false, value: null };
  }
  return coerceArrayValue(parsed.value, paramName);
}

function parseLooseArrayElementValue(raw) {
  const s = toStringSafe(raw).trim();
  if (!s) {
    return { ok: false, value: null };
  }

  const literal = parseJSONLiteralValue(s);
  if (literal.ok) {
    return literal;
  }

  const repairedBackslashes = repairInvalidJSONBackslashes(s);
  if (repairedBackslashes !== s) {
    try {
      const parsed = JSON.parse(repairedBackslashes);
      return { ok: true, value: parsed };
    } catch (_err) {
      // Fall through.
    }
  }

  const repairedLoose = repairLooseJSON(s);
  if (repairedLoose !== s) {
    try {
      const parsed = JSON.parse(repairedLoose);
      return { ok: true, value: parsed };
    } catch (_err) {
      // Fall through.
    }
  }

  if (s.includes('<') && s.includes('>')) {
    const parsed = parseMarkupInput(s);
    if (Array.isArray(parsed)) {
      return { ok: true, value: parsed };
    }
    if (parsed && typeof parsed === 'object') {
      return { ok: true, value: parsed };
    }
  }

  return { ok: false, value: null };
}

function coerceArrayValue(value, paramName = '') {
  if (Array.isArray(value)) {
    return { ok: true, value };
  }
  if (!value || typeof value !== 'object') {
    return { ok: false, value: null };
  }

  const keys = Object.keys(value);
  if (keys.length !== 1) {
    return { ok: false, value: null };
  }

  if (Object.prototype.hasOwnProperty.call(value, 'item')) {
    const items = value.item;
    const nested = coerceArrayValue(items, '');
    return nested.ok ? nested : { ok: true, value: [items] };
  }

  if (paramName && Object.prototype.hasOwnProperty.call(value, paramName)) {
    const nested = coerceArrayValue(value[paramName], '');
    if (nested.ok) {
      return nested;
    }
  }

  return { ok: false, value: null };
}

function splitTopLevelJSONValues(raw) {
  const s = toStringSafe(raw).trim();
  if (!s) {
    return [];
  }

  const values = [];
  let start = 0;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{' || ch === '[') {
      depth += 1;
      continue;
    }
    if (ch === '}' || ch === ']') {
      if (depth > 0) {
        depth -= 1;
      }
      continue;
    }
    if (ch === ',' && depth === 0) {
      const segment = s.slice(start, i).trim();
      if (!segment) {
        return [];
      }
      values.push(segment);
      start = i + 1;
    }
  }

  const last = s.slice(start).trim();
  if (!last) {
    return [];
  }
  values.push(last);
  return values.length > 1 ? values : [];
}

function repairInvalidJSONBackslashes(s) {
  if (!s || !s.includes('\\')) {
    return s;
  }

  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    if (i + 1 < s.length) {
      const next = s[i + 1];
      if ('"\\/bfnrt'.includes(next)) {
        out += `\\${next}`;
        i += 1;
        continue;
      }
      if (next === 'u' && i + 5 < s.length) {
        let isHex = true;
        for (let j = 1; j <= 4; j += 1) {
          const r = s[i + 1 + j];
          if (!/[0-9a-fA-F]/.test(r)) {
            isHex = false;
            break;
          }
        }
        if (isHex) {
          out += `\\u${s.slice(i + 2, i + 6)}`;
          i += 5;
          continue;
        }
      }
    }
    out += '\\\\';
  }
  return out;
}

function repairLooseJSON(s) {
  const raw = toStringSafe(s).trim();
  if (!raw) {
    return raw;
  }
  let out = raw.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
  out = out.replace(/(:\s*)(\{(?:[^{}]|\{[^{}]*\})*\}(?:\s*,\s*\{(?:[^{}]|\{[^{}]*\})*\})+)/g, '$1[$2]');
  return out;
}

function sanitizeLooseCDATA(text) {
  const raw = toStringSafe(text);
  if (!raw) {
    return '';
  }

  let out = '';
  let pos = 0;
  let changed = false;
  while (pos < raw.length) {
    const start = indexToolCDATAOpen(raw, pos);
    if (start < 0) {
      out += raw.slice(pos);
      break;
    }
    const openLen = toolCDATAOpenLenAt(raw, start);
    const contentStart = start + openLen;
    out += raw.slice(pos, start);

    const endRel = findToolCDATAEnd(raw, contentStart);
    if (endRel >= 0) {
      const end = endRel + toolCDATACloseLenAt(raw, endRel);
      out += raw.slice(start, end);
      pos = end;
      continue;
    }

    changed = true;
    out += raw.slice(contentStart);
    pos = raw.length;
  }

  return changed ? out : raw;
}

function hasRepairableXMLToolCallsWrapper(text) {
  const raw = toStringSafe(text).trim();
  if (!raw || firstToolMarkupTagByName(raw, 'tool_calls', false)) {
    return false;
  }
  const invoke = firstToolMarkupTagByName(raw, 'invoke', false);
  if (!invoke) {
    return false;
  }
  const close = lastToolMarkupTagByName(raw, 'tool_calls', true);
  if (!close) {
    return false;
  }
  return invoke.start < close.start;
}

function repairMissingXMLToolCallsOpeningWrapper(text) {
  const raw = toStringSafe(text);
  if (firstToolMarkupTagByName(raw, 'tool_calls', false)) {
    return raw;
  }
  const invoke = firstToolMarkupTagByName(raw, 'invoke', false);
  const close = lastToolMarkupTagByName(raw, 'tool_calls', true);
  if (!invoke || !close || invoke.start >= close.start) {
    return raw;
  }
  return `${raw.slice(0, invoke.start)}<tool_calls>${raw.slice(invoke.start, close.start)}</tool_calls>${raw.slice(close.end + 1)}`;
}

function firstToolMarkupTagByName(text, name, closing) {
  const raw = toStringSafe(text);
  for (let searchFrom = 0; searchFrom < raw.length;) {
    const tag = findToolMarkupTagOutsideIgnored(raw, searchFrom);
    if (!tag) {
      break;
    }
    if (tag.name === name && tag.closing === closing) {
      return tag;
    }
    searchFrom = tag.end + 1;
  }
  return null;
}

function lastToolMarkupTagByName(text, name, closing) {
  const raw = toStringSafe(text);
  let last = null;
  for (let searchFrom = 0; searchFrom < raw.length;) {
    const tag = findToolMarkupTagOutsideIgnored(raw, searchFrom);
    if (!tag) {
      break;
    }
    if (tag.name === name && tag.closing === closing) {
      last = tag;
    }
    searchFrom = tag.end + 1;
  }
  return last;
}

function rawNameForTag(tag) {
  for (const candidate of TOOL_MARKUP_NAMES) {
    if (candidate.canonical === tag.name) {
      return candidate.raw;
    }
  }
  return tag.name || '';
}

function toolCDATAOpenLenAt(text, idx) {
  const raw = toStringSafe(text);
  const start = skipToolMarkupIgnorables(raw, idx);
  const ltLen = xmlTagStartDelimiterLenAt(raw, start);
  if (!ltLen) {
    return 0;
  }
  let pos = start + ltLen;
  for (let skipped = 0; skipped <= 4 && pos < raw.length; skipped += 1) {
    pos = skipToolMarkupIgnorables(raw, pos);
    if (raw[pos] === '[') {
      pos += 1;
      const keyword = consumeToolKeyword(raw, pos, 'cdata');
      if (!keyword.ok) {
        return 0;
      }
      pos = skipToolMarkupIgnorables(raw, keyword.next);
      if (raw[pos] !== '[') {
        return 0;
      }
      pos += 1;
      return pos - idx;
    }
    const cp = raw.codePointAt(pos);
    if (cp === undefined) {
      return 0;
    }
    const ch = String.fromCodePoint(cp);
    if (!isToolMarkupSeparator(ch)) {
      return 0;
    }
    pos += ch.length;
  }
  return 0;
}

function toolCDATACloseLenAt(text, idx) {
  const raw = toStringSafe(text);
  const start = skipToolMarkupIgnorables(raw, idx);
  if (raw[start] !== ']') {
    return 0;
  }
  let pos = start + 1;
  pos = skipToolMarkupIgnorables(raw, pos);
  if (raw[pos] !== ']') {
    return 0;
  }
  pos += 1;
  const gtLen = xmlTagEndDelimiterLenAt(raw, pos);
  return gtLen ? (pos + gtLen) - idx : 0;
}

function findToolCDATAEnd(text, from) {
  const raw = toStringSafe(text);
  if (from < 0 || from >= raw.length) {
    return -1;
  }
  let firstNonFenceEnd = -1;
  for (let i = from; i < raw.length; i += 1) {
    const closeLen = toolCDATACloseLenAt(raw, i);
    if (!closeLen) {
      continue;
    }
    const end = i;
    if (cdataOffsetIsInsideMarkdownFence(raw.slice(from, end))) {
      continue;
    }
    if (cdataEndLooksStructural(raw, end + closeLen)) {
      return end;
    }
    if (firstNonFenceEnd < 0) {
      firstNonFenceEnd = end;
    }
    i = end + closeLen - 1;
  }
  return firstNonFenceEnd;
}

function indexToolCDATAOpen(text, from = 0) {
  const raw = toStringSafe(text);
  for (let i = Math.max(0, from || 0); i < raw.length; i += 1) {
    if (toolCDATAOpenLenAt(raw, i)) {
      return i;
    }
  }
  return -1;
}

function findTrailingToolCDATACloseStart(text) {
  const raw = toStringSafe(text);
  for (let i = raw.length - 1; i >= 0; i -= 1) {
    const closeLen = toolCDATACloseLenAt(raw, i);
    if (closeLen && i + closeLen === raw.length) {
      return i;
    }
  }
  return -1;
}

function cdataOffsetIsInsideMarkdownFence(fragment) {
  const lines = toStringSafe(fragment).split('\n');
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;
  for (const line of lines) {
    const trimmed = line.replace(/^[ \t]+/, '');
    if (!inFence) {
      const fence = parseFenceOpenLine(trimmed);
      if (fence) {
        inFence = true;
        fenceChar = fence.ch;
        fenceLen = fence.count;
      }
      continue;
    }
    if (isFenceCloseLine(trimmed, fenceChar, fenceLen)) {
      inFence = false;
      fenceChar = '';
      fenceLen = 0;
    }
  }
  return inFence;
}

function cdataEndLooksStructural(text, after) {
  const raw = toStringSafe(text);
  let pos = after;
  while (pos < raw.length) {
    const ch = raw[pos];
    if ([' ', '\t', '\r', '\n'].includes(ch)) {
      pos += 1;
      continue;
    }
    return raw.startsWith('</', pos) || raw.startsWith('<／', pos) || raw.startsWith('＜/', pos) || raw.startsWith('＜／', pos);
  }
  return true;
}

function parseTagAttributes(raw) {
  const source = toStringSafe(raw);
  const out = {};
  if (!source) {
    return out;
  }
  for (const match of source.matchAll(XML_ATTR_PATTERN)) {
    const key = toStringSafe(match[1]).trim().toLowerCase();
    if (!key) {
      continue;
    }
    out[key] = match.slice(3).find((value) => value !== undefined && value !== '') || '';
  }
  return out;
}

function parseToolCallInput(v) {
  if (v == null) {
    return {};
  }
  if (typeof v === 'string') {
    const raw = toStringSafe(v);
    if (!raw) {
      return {};
    }
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
      return { _raw: raw };
    } catch (_err) {
      return { _raw: raw };
    }
  }
  if (typeof v === 'object' && !Array.isArray(v)) {
    return v;
  }
  try {
    const parsed = JSON.parse(JSON.stringify(v));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch (_err) {
    return {};
  }
  return {};
}

function appendMarkupValue(out, key, value) {
  if (Object.prototype.hasOwnProperty.call(out, key)) {
    const current = out[key];
    if (Array.isArray(current)) {
      current.push(value);
      return;
    }
    out[key] = [current, value];
    return;
  }
  out[key] = value;
}

function isOnlyRawValue(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return false;
  }
  const keys = Object.keys(obj);
  return keys.length === 1 && keys[0] === '_raw';
}

module.exports = {
  stripFencedCodeBlocks,
  stripMarkdownCodeSpans,
  parseMarkupToolCalls,
  normalizeDSMLToolCallMarkup,
  containsToolMarkupSyntaxOutsideIgnored,
  containsToolCallWrapperSyntaxOutsideIgnored,
  hasRepairableXMLToolCallsWrapper,
  findToolMarkupTagOutsideIgnored,
  findMatchingToolMarkupClose,
  findPartialToolMarkupStart,
  indexToolCDATAOpen,
  sanitizeLooseCDATA,
};
