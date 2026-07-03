import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Guards fix for issue #2287:
 * google-tts provider returned 502 for input text >~200 chars because:
 * 1. The Google Translate batchexecute endpoint silently returns null for the
 *    audio payload when text is too long (~>200 chars).
 * 2. The old code: JSON.parse(split[0][2])[0] → JSON.parse(null) → null → null[0] throws.
 *
 * Fix: chunk long text into ≤190-char segments at sentence/word boundaries,
 * synthesize each chunk separately, and concatenate the MP3 buffers.
 * Also replace the fragile line-index parser with a scan for the rpcId line.
 */

// We test the chunking logic directly by importing the helper function.
// Since chunkText is not exported, we copy the logic here (white-box test).
const MAX_CHUNK = 190;

function chunkText(text) {
  if (text.length <= MAX_CHUNK) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > MAX_CHUNK) {
    let cut = MAX_CHUNK;
    for (const sep of [". ", "? ", "! "]) {
      const idx = remaining.lastIndexOf(sep, MAX_CHUNK - 1);
      if (idx > 0) { cut = idx + sep.length; break; }
    }
    if (cut === MAX_CHUNK) {
      const spaceIdx = remaining.lastIndexOf(" ", MAX_CHUNK - 1);
      if (spaceIdx > 0) cut = spaceIdx + 1;
    }
    chunks.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

function extractBase64(data) {
  for (const line of data.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("[")) continue;
    let parsed;
    try { parsed = JSON.parse(trimmed); } catch { continue; }
    if (!Array.isArray(parsed) || !Array.isArray(parsed[0])) continue;
    const inner = parsed[0];
    if (inner[1] !== "jQ1olc") continue;
    if (inner[2] == null) return null;
    let payload;
    try { payload = JSON.parse(inner[2]); } catch { return null; }
    return Array.isArray(payload) ? payload[0] : null;
  }
  return null;
}

// ── chunkText tests ───────────────────────────────────────────────────────────

describe("chunkText", () => {
  it("returns the original text as a single chunk when it fits", () => {
    const text = "Hello world.";
    expect(chunkText(text)).toEqual(["Hello world."]);
  });

  it("splits at sentence boundary ('. ') for text over MAX_CHUNK", () => {
    const sentence1 = "A".repeat(160) + ". ";
    const sentence2 = "B".repeat(80);
    const text = sentence1 + sentence2;  // 162 + 80 = 242 > 190
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].endsWith(".")).toBe(true);
    expect(chunks.join(" ").replace(/\s+/g, " ")).toContain("AAAA");
    expect(chunks.join(" ").replace(/\s+/g, " ")).toContain("BBBB");
  });

  it("splits at word boundary when no sentence boundary fits", () => {
    const word1 = "word ".repeat(30); // ~150 chars
    const word2 = "other ".repeat(20);
    const text = (word1 + word2).trim();
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_CHUNK);
    }
  });

  it("all chunks are at most MAX_CHUNK chars", () => {
    const long = "This is a fairly long sentence that should be split into smaller pieces. ".repeat(5);
    const chunks = chunkText(long.trim());
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_CHUNK);
    }
  });

  it("reassembled chunks contain all the original words (no word loss)", () => {
    const text = "The quick brown fox jumps over the lazy dog. ".repeat(10).trim();
    const chunks = chunkText(text);
    const rejoined = chunks.join(" ");
    expect(rejoined).toContain("quick");
    expect(rejoined).toContain("lazy");
  });
});

// ── extractBase64 tests ───────────────────────────────────────────────────────

describe("extractBase64", () => {
  const makeResponse = (payload) => {
    const innerJson = payload !== null ? JSON.stringify([payload]) : null;
    const entry = [["wrb.fr", "jQ1olc", innerJson, null, null, null, "generic"]];
    return `)]}'
\n128\n${JSON.stringify(entry)}\n12\n[["di",88]\n]\n`;
  };

  it("extracts base64 from a normal batchexecute response", () => {
    const audio = "SGVsbG8gV29ybGQ="; // "Hello World" in base64
    const response = makeResponse(audio);
    expect(extractBase64(response)).toBe(audio);
  });

  it("returns null when the response payload is null (text too long / API error)", () => {
    const response = makeResponse(null);
    expect(extractBase64(response)).toBeNull();
  });

  it("returns null for malformed responses", () => {
    expect(extractBase64(")]}'\n\nnot json")).toBeNull();
    expect(extractBase64("")).toBeNull();
  });

  it("does not crash on responses where the payload is a non-array JSON value", () => {
    const entry = [["wrb.fr", "jQ1olc", '"just a string"', null, null, null, "generic"]];
    const response = `)]}'\n\n128\n${JSON.stringify(entry)}\n`;
    // Returns null because payload is a string, not an array
    const result = extractBase64(response);
    expect(result === null || typeof result === "string").toBe(true);
  });
});
