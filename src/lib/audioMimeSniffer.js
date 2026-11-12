/**
 * Audio MIME sniffing from magic bytes.
 *
 * The endpoint claims OpenAI Whisper compatibility, and Whisper clients
 * frequently stream raw audio with a generic or missing content type (curl
 * sends `application/octet-stream` for extension-less filenames). Gemini's
 * `inline_data` blob rejects such payloads with
 * "Unsupported MIME type: application/octet-stream", so we detect the real
 * container from the file's leading bytes and prefer it over whatever the
 * client declared.
 *
 * Pure functions only — no fetch, no fs — so tests can drive them directly.
 */

// Canonical MIME types for the sniffable containers.
export const AUDIO_MIMES = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  flac: "audio/flac",
  webm: "audio/webm",
};

/**
 * Detect the audio container from leading magic bytes.
 * @param {ArrayBuffer|Uint8Array|null|undefined} bytes leading bytes of the file
 * @returns {string|null} canonical MIME type, or null when nothing matches
 */
export function sniffAudioMime(bytes) {
  if (!bytes) return null;
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 2) return null;

  // WAV: 'RIFF' + 4-byte size + 'WAVE' (needs 12 bytes)
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x41 && b[10] === 0x56 && b[11] === 0x45) {
    return AUDIO_MIMES.wav;
  }
  // MP3: 'ID3' tag, or 0xFF + frame sync (111x xxxx)
  if (b.length >= 3 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return AUDIO_MIMES.mp3;
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return AUDIO_MIMES.mp3;
  // OGG: 'OggS'
  if (b.length >= 4 && b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return AUDIO_MIMES.ogg;
  // FLAC: 'fLaC'
  if (b.length >= 4 && b[0] === 0x66 && b[1] === 0x4c && b[2] === 0x61 && b[3] === 0x43) return AUDIO_MIMES.flac;
  // WebM/Matroska: EBML header 0x1A45DFA3
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return AUDIO_MIMES.webm;

  return null;
}

/**
 * Resolve the MIME type to use for an audio payload: a sniffed container
 * always wins; otherwise fall back to a client-declared type that is already
 * `audio/*`; otherwise null (caller applies its own fallback, e.g. the
 * filename-extension map or the documented error).
 *
 * @param {ArrayBuffer|Uint8Array|null|undefined} bytes leading bytes of the file
 * @param {string|null|undefined} clientType client-provided Content-Type
 * @returns {string|null}
 */
export function resolveAudioMimeType(bytes, clientType) {
  const sniffed = sniffAudioMime(bytes);
  if (sniffed) return sniffed;
  const t = typeof clientType === "string" ? clientType.toLowerCase().trim() : "";
  if (t.startsWith("audio/")) return t;
  return null;
}
