// Claude vs Gemini thinking signature validation.
// E-form: single-layer base64, decoded[0] == 0x12.
// R-form: double-layer base64, outer decoded[0] == "E", inner decoded[0] == 0x12.
// Note: Antigravity Gemini signatures ALSO start with 0x12 (outer field 2),
// but their inner field 1 (0x0a) spans the entire outer payload (v1.val === (v2.next - v1.next) + v2.val).
// Anthropic Claude signatures have a 70-byte metadata submessage in field 1 (0x0a) followed by
// a separate encrypted body in field 2 (0x12), so v1.val > (v2.next - v1.next) + v2.val.

const MAX_CLAUDE_SIGNATURE_LEN = 32 * 1024 * 1024;
const CLAUDE_SIGNATURE_MARKER = 0x12;

function stripCachePrefix(rawSignature) {
  const sig = (rawSignature || "").trim();
  if (!sig) return "";
  const idx = sig.indexOf("#");
  return idx >= 0 ? sig.slice(idx + 1).trim() : sig;
}

function readVarint(buf, offset) {
  let val = 0;
  let shift = 0;
  let pos = offset;
  while (pos < buf.length) {
    const b = buf[pos++];
    val |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) return { val, next: pos };
    shift += 7;
    if (shift > 35) return null;
  }
  return null;
}

function isAntigravityGeminiEnvelope(buf) {
  if (!buf || buf.length < 4 || buf[0] !== CLAUDE_SIGNATURE_MARKER) return false;
  const v1 = readVarint(buf, 1);
  if (!v1 || buf[v1.next] !== 0x0a) return false;
  const v2 = readVarint(buf, v1.next + 1);
  if (!v2) return false;
  // In all Antigravity Gemini signatures (Gemini 3.x and Gemini 4 Argon),
  // inner field 1 (0x0a) spans the entire outer field 2 (0x12).
  // In Claude signatures, inner field 1 is only the header (~70 bytes) followed by field 2.
  return v1.val > 0 && v1.val === (v2.next - v1.next) + v2.val && buf[v2.next] !== 0x08;
}

export function hasClaudeSignaturePrefix(rawSignature) {
  const sig = stripCachePrefix(rawSignature);
  return sig.length > 0 && (sig[0] === "E" || sig[0] === "R");
}

// Strict-ish: validates base64 layers + Claude marker byte, excluding Antigravity Gemini envelopes.
export function isValidClaudeSignature(rawSignature) {
  const sig = stripCachePrefix(rawSignature);
  if (!sig || sig.length > MAX_CLAUDE_SIGNATURE_LEN) return false;

  try {
    if (sig[0] === "E") {
      const decoded = Buffer.from(sig, "base64");
      if (decoded.length === 0 || decoded[0] !== CLAUDE_SIGNATURE_MARKER) return false;
      if (isAntigravityGeminiEnvelope(decoded)) return false;
      return true;
    }
    if (sig[0] === "R") {
      const outer = Buffer.from(sig, "base64");
      if (!outer.length || outer[0] !== 0x45) return false; // "E"
      const inner = Buffer.from(outer.toString(), "base64");
      if (inner.length === 0 || inner[0] !== CLAUDE_SIGNATURE_MARKER) return false;
      if (isAntigravityGeminiEnvelope(inner)) return false;
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
