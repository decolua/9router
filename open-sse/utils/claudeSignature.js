// Claude thinking signature validation (ported from CLIProxyAPI internal/signature).
// E-form: single-layer base64, decoded[0] == 0x12 (Claude marker).
// R-form: double-layer base64, outer decoded[0] == 'E', inner decoded[0] == 0x12.
// C-form (CAIS/CAQS, current Anthropic models): single-layer base64, decoded[0] == 0x08.
//   The payload is a protobuf envelope: field 1 varint (envelope version), field 2
//   the container (field 1 = channel block), optional field 3 varint. Validation is
//   structural; version, channel id and block kind are incidental and not pinned.
//   A "C" prefix alone is not enough: Gemini CLI signatures start with "C" too.
// Cache prefix "...#sig" stripped before validation.

const MAX_CLAUDE_SIGNATURE_LEN = 32 * 1024 * 1024;
const CLAUDE_SIGNATURE_MARKER = 0x12;
const CLAUDE_CAIS_MARKER = 0x08;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_BYTES = 2;
const WIRE_FIXED32 = 5;

function stripCachePrefix(rawSignature) {
  const sig = (rawSignature || "").trim();
  if (!sig) return "";
  const idx = sig.indexOf("#");
  return idx >= 0 ? sig.slice(idx + 1).trim() : sig;
}

// Returns the end offset of the varint at `pos`, or -1 if it runs past `end`.
function skipVarint(buf, pos, end) {
  for (let i = 0; i < 10 && pos < end; i++) {
    if ((buf[pos++] & 0x80) === 0) return pos;
  }
  return -1;
}

// Reads the varint at cursor.pos into cursor.value and advances cursor.pos.
// Returns false if it runs past `end`. Mutates one cursor per scan instead of
// allocating per field: signatures come from untrusted request bodies.
function readVarint(buf, cursor, end) {
  let value = 0;
  let scale = 1;
  for (let i = 0; i < 10 && cursor.pos < end; i++) {
    const byte = buf[cursor.pos++];
    value += (byte & 0x7f) * scale;
    if ((byte & 0x80) === 0) {
      cursor.value = value;
      return true;
    }
    scale *= 128;
  }
  return false;
}

// Scans buf[start, end) as a protobuf field sequence in O(1) memory.
// Returns null unless the whole range is well-formed and field `wanted` occurs
// at most once, as a length-delimited field. Otherwise returns that field's
// [start, end) range, or an empty object when it is absent.
function scanFields(buf, start, end, wanted) {
  const cursor = { pos: start, value: 0 };
  let match = {};
  let seen = false;
  while (cursor.pos < end) {
    if (!readVarint(buf, cursor, end)) return null;
    const number = Math.floor(cursor.value / 8);
    const wireType = cursor.value % 8;
    if (number === 0) return null;
    if (number === wanted) {
      if (seen || wireType !== WIRE_BYTES) return null;
      seen = true;
    }
    if (wireType === WIRE_VARINT) {
      cursor.pos = skipVarint(buf, cursor.pos, end);
      if (cursor.pos < 0) return null;
    } else if (wireType === WIRE_BYTES) {
      if (!readVarint(buf, cursor, end) || cursor.pos + cursor.value > end) return null;
      if (number === wanted) match = { start: cursor.pos, end: cursor.pos + cursor.value };
      cursor.pos += cursor.value;
    } else if (wireType === WIRE_FIXED64 || wireType === WIRE_FIXED32) {
      cursor.pos += wireType === WIRE_FIXED64 ? 8 : 4;
      if (cursor.pos > end) return null;
    } else {
      return null;
    }
  }
  return match;
}

// envelope → exactly one container (field 2) → exactly one non-empty channel
// block (field 1) → channel block itself is a protobuf message.
function isClaudeCaisPayload(decoded) {
  if (decoded[0] !== CLAUDE_CAIS_MARKER) return false;
  const container = scanFields(decoded, 0, decoded.length, 2);
  if (!container?.end) return false;
  const channel = scanFields(decoded, container.start, container.end, 1);
  if (!channel?.end || channel.end === channel.start) return false;
  return scanFields(decoded, channel.start, channel.end, 0) !== null;
}

// Strict-ish: validates base64 layers + Claude marker byte (E/R) or envelope structure (C).
export function isValidClaudeSignature(rawSignature) {
  const sig = stripCachePrefix(rawSignature);
  if (!sig || sig.length > MAX_CLAUDE_SIGNATURE_LEN) return false;

  try {
    if (sig[0] === "E") {
      const decoded = Buffer.from(sig, "base64");
      return decoded.length > 0 && decoded[0] === CLAUDE_SIGNATURE_MARKER;
    }
    if (sig[0] === "R") {
      const outer = Buffer.from(sig, "base64");
      if (!outer.length || outer[0] !== 0x45) return false; // 'E'
      const inner = Buffer.from(outer.toString(), "base64");
      return inner.length > 0 && inner[0] === CLAUDE_SIGNATURE_MARKER;
    }
    if (sig[0] === "C") {
      // Buffer.from silently skips invalid characters; a structural check needs exact bytes.
      if (sig.length % 4 !== 0 || !BASE64.test(sig)) return false;
      return isClaudeCaisPayload(Buffer.from(sig, "base64"));
    }
    return false;
  } catch {
    return false;
  }
}
