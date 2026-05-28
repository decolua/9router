'use strict';
const {
  resetIncrementalToolState,
  noteText,
  insideCodeFenceWithState,
} = require('./state');
const { trimWrappingJSONFence } = require('./jsonscan');
const {
  findToolMarkupTagOutsideIgnored,
  sanitizeLooseCDATA,
} = require('./parse_payload');
const {
  consumeXMLToolCapture: consumeXMLToolCaptureImpl,
  hasOpenXMLToolTag,
  shouldKeepBareInvokeCapture,
  findPartialXMLToolTagStart,
} = require('./sieve-xml');
function processToolSieveChunk(state, chunk, toolNames) {
  if (!state) {
    return [];
  }
  if (chunk) {
    state.pending += chunk;
  }
  const events = [];
  while (true) {
    if (Array.isArray(state.pendingToolCalls) && state.pendingToolCalls.length > 0) {
      events.push({ type: 'tool_calls', calls: state.pendingToolCalls });
      state.pendingToolRaw = '';
      state.pendingToolCalls = [];
      continue;
    }
    if (state.capturing) {
      if (state.pending) {
        state.capture += state.pending;
        state.pending = '';
      }
      const consumed = consumeToolCapture(state, toolNames);
      if (!consumed.ready) {
        break;
      }
      const captured = state.capture;
      state.capture = '';
      state.capturing = false;
      resetIncrementalToolState(state);

      if (Array.isArray(consumed.calls) && consumed.calls.length > 0) {
        if (consumed.prefix) {
          noteText(state, consumed.prefix);
          events.push({ type: 'text', text: consumed.prefix });
        }
        state.pendingToolRaw = captured;
        state.pendingToolCalls = consumed.calls;
        if (consumed.suffix) {
          state.pending = consumed.suffix + state.pending;
        }
        continue;
      }
      if (consumed.prefix) {
        noteText(state, consumed.prefix);
        events.push({ type: 'text', text: consumed.prefix });
      }
      if (consumed.suffix) {
        state.pending += consumed.suffix;
      }
      continue;
    }
    const pending = state.pending || '';
    if (!pending) {
      break;
    }
    const start = findToolSegmentStart(state, pending);
    if (start === HOLD_TOOL_SEGMENT_START) {
      break;
    }
    if (start >= 0) {
      const prefix = pending.slice(0, start);
      if (prefix) {
        const resetMarkdownSpan = shouldResetUnclosedMarkdownPrefix(state, prefix, pending.slice(start));
        noteText(state, prefix);
        if (resetMarkdownSpan) {
          state.markdownCodeSpanTicks = 0;
        }
        events.push({ type: 'text', text: prefix });
      }
      state.pending = '';
      state.capture += pending.slice(start);
      state.capturing = true;
      resetIncrementalToolState(state);
      continue;
    }
    const [safe, hold] = splitSafeContentForToolDetection(state, pending);
    if (!safe) {
      break;
    }
    state.pending = hold;
    noteText(state, safe);
    events.push({ type: 'text', text: safe });
  }
  return events;
}

function flushToolSieve(state, toolNames) {
  if (!state) {
    return [];
  }
  const events = processToolSieveChunk(state, '', toolNames);
  if (state.pending && Number.isInteger(state.markdownCodeSpanTicks) && state.markdownCodeSpanTicks > 0) {
    state.markdownCodeSpanTicks = 0;
    events.push(...processToolSieveChunk(state, '', toolNames));
  }
  if (Array.isArray(state.pendingToolCalls) && state.pendingToolCalls.length > 0) {
    events.push({ type: 'tool_calls', calls: state.pendingToolCalls });
    state.pendingToolRaw = '';
    state.pendingToolCalls = [];
  }
  if (state.capturing) {
    const consumed = consumeToolCapture(state, toolNames);
    if (consumed.ready) {
      if (consumed.prefix) {
        noteText(state, consumed.prefix);
        events.push({ type: 'text', text: consumed.prefix });
      }
      if (Array.isArray(consumed.calls) && consumed.calls.length > 0) {
        events.push({ type: 'tool_calls', calls: consumed.calls });
      }
      if (consumed.suffix) {
        noteText(state, consumed.suffix);
        events.push({ type: 'text', text: consumed.suffix });
      }
    } else if (state.capture) {
      const content = state.capture;
      const recovered = sanitizeLooseCDATA(content);
      if (recovered !== content) {
        const recoveredResult = consumeXMLToolCaptureImpl(recovered, toolNames, trimWrappingJSONFence);
        if (recoveredResult.ready && Array.isArray(recoveredResult.calls) && recoveredResult.calls.length > 0) {
          if (recoveredResult.prefix) {
            noteText(state, recoveredResult.prefix);
            events.push({ type: 'text', text: recoveredResult.prefix });
          }
          events.push({ type: 'tool_calls', calls: recoveredResult.calls });
          if (recoveredResult.suffix) {
            noteText(state, recoveredResult.suffix);
            events.push({ type: 'text', text: recoveredResult.suffix });
          }
        } else {
          noteText(state, content);
          events.push({ type: 'text', text: content });
        }
      } else {
        noteText(state, content);
        events.push({ type: 'text', text: content });
      }
    }
    state.capture = '';
    state.capturing = false;
    resetIncrementalToolState(state);
  }
  if (state.pending) {
    noteText(state, state.pending);
    events.push({ type: 'text', text: state.pending });
    state.pending = '';
  }
  return events;
}

function splitSafeContentForToolDetection(state, s) {
  const text = s || '';
  if (!text) {
    return ['', ''];
  }
  // Only hold back partial XML tool tags.
  const xmlIdx = findPartialXMLToolTagStart(text);
  if (xmlIdx >= 0) {
    if (insideCodeFenceWithState(state, text.slice(0, xmlIdx))) {
      return [text, ''];
    }
    const markdown = markdownCodeSpanStateAt(state, text.slice(0, xmlIdx));
    if (markdown.ticks > 0) {
      if (markdownCodeSpanCloses(text.slice(xmlIdx), markdown.ticks)) {
        return [text, ''];
      }
      if (markdown.fromPrior) {
        return ['', text];
      }
    }
    if (xmlIdx > 0) {
      return [text.slice(0, xmlIdx), text.slice(xmlIdx)];
    }
    return ['', text];
  }
  return [text, ''];
}

const HOLD_TOOL_SEGMENT_START = -2;

function findToolSegmentStart(state, s) {
  if (!s) {
    return -1;
  }
  let offset = 0;
  while (true) {
    const tag = findToolMarkupTagOutsideIgnored(s, offset);
    if (!tag) {
      return -1;
    }
    if (insideCodeFenceWithState(state, s.slice(0, tag.start))) {
      offset = tag.end + 1;
      continue;
    }
    const markdown = markdownCodeSpanStateAt(state, s.slice(0, tag.start));
    if (markdown.ticks === 0) {
      return tag.start;
    }
    if (markdownCodeSpanCloses(s.slice(tag.start), markdown.ticks)) {
      offset = tag.end + 1;
      continue;
    }
    if (markdown.fromPrior) {
      return HOLD_TOOL_SEGMENT_START;
    }
    return tag.start;
  }
}

function markdownCodeSpanStateAt(state, text) {
  const raw = typeof text === 'string' ? text : '';
  let ticks = state && Number.isInteger(state.markdownCodeSpanTicks) ? state.markdownCodeSpanTicks : 0;
  let fromPrior = ticks > 0;
  for (let i = 0; i < raw.length;) {
    if (raw[i] !== '`') {
      i += 1;
      continue;
    }
    const run = countBacktickRun(raw, i);
    if (ticks === 0) {
      if (run >= 3 && atMarkdownFenceLineStart(raw, i)) {
        i += run;
        continue;
      }
      if (state && insideCodeFenceWithState(state, raw.slice(0, i))) {
        i += run;
        continue;
      }
      ticks = run;
      fromPrior = false;
    } else if (run === ticks) {
      ticks = 0;
      fromPrior = false;
    }
    i += run;
  }
  return { ticks, fromPrior };
}

function markdownCodeSpanCloses(text, ticks) {
  const raw = typeof text === 'string' ? text : '';
  if (!Number.isInteger(ticks) || ticks <= 0) {
    return false;
  }
  for (let i = 0; i < raw.length;) {
    if (raw[i] !== '`') {
      i += 1;
      continue;
    }
    const run = countBacktickRun(raw, i);
    if (run === ticks) {
      return true;
    }
    i += run;
  }
  return false;
}

function shouldResetUnclosedMarkdownPrefix(state, prefix, suffix) {
  const markdown = markdownCodeSpanStateAt(state, prefix);
  return markdown.ticks > 0 && !markdown.fromPrior && !markdownCodeSpanCloses(suffix, markdown.ticks);
}

function countBacktickRun(text, start) {
  let count = 0;
  while (start + count < text.length && text[start + count] === '`') {
    count += 1;
  }
  return count;
}

function atMarkdownFenceLineStart(text, idx) {
  for (let i = idx - 1; i >= 0; i -= 1) {
    const ch = text[i];
    if (ch === ' ' || ch === '\t') {
      continue;
    }
    return ch === '\n' || ch === '\r';
  }
  return true;
}

function consumeToolCapture(state, toolNames) {
  const captured = state.capture || '';
  if (!captured) {
    return { ready: false, prefix: '', calls: [], suffix: '' };
  }

  // XML-only tool call extraction.
  const xmlResult = consumeXMLToolCaptureImpl(captured, toolNames, trimWrappingJSONFence);
  if (xmlResult.ready) {
    return xmlResult;
  }
  // If XML tags are present but block is incomplete, keep buffering.
  if (hasOpenXMLToolTag(captured)) {
    return { ready: false, prefix: '', calls: [], suffix: '' };
  }
  if (shouldKeepBareInvokeCapture(captured)) {
    return { ready: false, prefix: '', calls: [], suffix: '' };
  }

  // No XML tool tags detected — release captured content as text.
  return {
    ready: true,
    prefix: captured,
    calls: [],
    suffix: '',
  };
}

module.exports = {
  processToolSieveChunk,
  flushToolSieve,
};
