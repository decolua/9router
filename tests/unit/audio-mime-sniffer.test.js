import { describe, it, expect } from "vitest";
import { sniffAudioMime, resolveAudioMimeType, AUDIO_MIMES } from "@/lib/audioMimeSniffer.js";

// Realistic leading bytes per container (≥12 bytes so the WAV check can look
// at offsets 8..11). All signatures per the containers' specs.
function bytes(...nums) {
  return new Uint8Array(nums);
}

const WAV = bytes(0x52, 0x49, 0x46, 0x46, 0x24, 0x08, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20); // RIFF....WAVEfmt
const MP3_ID3 = bytes(0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xfb);
const MP3_FRAME = bytes(0xff, 0xfb, 0x90, 0x64); // 0xFF + MPEG frame sync (111x xxxx)
const OGG = bytes(0x4f, 0x67, 0x67, 0x53, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00);
const FLAC = bytes(0x66, 0x4c, 0x61, 0x43, 0x00, 0x00, 0x00, 0x22, 0x12, 0x00, 0x12, 0x00);
const WEBM = bytes(0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00);
const NOT_AUDIO = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d); // PNG

describe("sniffAudioMime", () => {
  it("detects WAV via RIFF....WAVE magic", () => {
    expect(sniffAudioMime(WAV)).toBe("audio/wav");
  });

  it("detects MP3 via ID3 tag", () => {
    expect(sniffAudioMime(MP3_ID3)).toBe("audio/mpeg");
  });

  it("detects MP3 via 0xFF MPEG frame sync", () => {
    expect(sniffAudioMime(MP3_FRAME)).toBe("audio/mpeg");
  });

  it("rejects non-frame-sync 0xFF pairs (0xFF 0x00 is not MPEG audio)", () => {
    expect(sniffAudioMime(bytes(0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00))).toBeNull();
  });

  it("detects OGG via OggS magic", () => {
    expect(sniffAudioMime(OGG)).toBe("audio/ogg");
  });

  it("detects FLAC via fLaC magic", () => {
    expect(sniffAudioMime(FLAC)).toBe("audio/flac");
  });

  it("detects WebM via EBML header", () => {
    expect(sniffAudioMime(WEBM)).toBe("audio/webm");
  });

  it("returns null for a non-audio signature (PNG)", () => {
    expect(sniffAudioMime(NOT_AUDIO)).toBeNull();
  });

  it("returns null for empty and short inputs", () => {
    expect(sniffAudioMime(null)).toBeNull();
    expect(sniffAudioMime(undefined)).toBeNull();
    expect(sniffAudioMime(new Uint8Array(0))).toBeNull();
    expect(sniffAudioMime(bytes(0x52, 0x49, 0x46, 0x46))).toBeNull();
  });

  it("accepts ArrayBuffer input (what file.arrayBuffer() yields)", () => {
    const ab = WAV.buffer.slice(WAV.byteOffset, WAV.byteOffset + WAV.byteLength);
    expect(sniffAudioMime(ab)).toBe("audio/wav");
  });
});

describe("resolveAudioMimeType (mime-resolution path used by the STT handler)", () => {
  it("a WAV payload labeled application/octet-stream resolves to audio/wav — the octet-stream end-to-end path (DF-9ROUTER-43)", () => {
    // Old behavior: client content-type passthrough would have returned
    // application/octet-stream, which Gemini rejects with "Unsupported MIME
    // type". The sniff must override it.
    expect(resolveAudioMimeType(WAV, "application/octet-stream")).toBe("audio/wav");
    expect(resolveAudioMimeType(WAV, "application/octet-stream")).not.toBe("application/octet-stream");
  });

  it("sniffed containers override any client-declared type", () => {
    expect(resolveAudioMimeType(OGG, "audio/wav")).toBe("audio/ogg");
    expect(resolveAudioMimeType(FLAC, "text/plain")).toBe("audio/flac");
    expect(resolveAudioMimeType(WEBM, "video/webm")).toBe("audio/webm");
  });

  it("falls back to client type when it is already audio/* and nothing sniffs", () => {
    expect(resolveAudioMimeType(NOT_AUDIO, "Audio/AAC")).toBe("audio/aac");
  });

  it("returns null when nothing sniffs and the client type is not audio/*", () => {
    expect(resolveAudioMimeType(NOT_AUDIO, "application/octet-stream")).toBeNull();
    expect(resolveAudioMimeType(NOT_AUDIO, "")).toBeNull();
    expect(resolveAudioMimeType(null, null)).toBeNull();
  });
});

describe("sniffed mime set matches the canonical AUDIO_MIMES map", () => {
  it("each supported container maps to its canonical MIME", () => {
    const cases = [
      [WAV, AUDIO_MIMES.wav],
      [MP3_ID3, AUDIO_MIMES.mp3],
      [MP3_FRAME, AUDIO_MIMES.mp3],
      [OGG, AUDIO_MIMES.ogg],
      [FLAC, AUDIO_MIMES.flac],
      [WEBM, AUDIO_MIMES.webm],
    ];
    for (const [payload, expected] of cases) {
      expect(sniffAudioMime(payload)).toBe(expected);
      expect(resolveAudioMimeType(payload, "application/octet-stream")).toBe(expected);
    }
  });
});
