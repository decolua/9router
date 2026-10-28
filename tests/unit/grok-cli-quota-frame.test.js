import { describe, it, expect } from "vitest";
import {
  decodeGrokCreditsFrame,
  probeFrameHeader,
} from "../../open-sse/services/usage/grokCliQuotaFrame.js";

/**
 * Minimal protobuf encoder for fixtures — real GetGrokCreditsConfig wire shape
 * (nested field 1 / fixed32 ratio / Timestamp reset + optional trailer 0x80).
 */

function encodeVarint(value) {
  const bytes = [];
  let v = BigInt(value);
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v !== 0n) byte |= 0x80;
    bytes.push(byte);
  } while (v !== 0n);
  return Buffer.from(bytes);
}

function encodeTag(fieldNumber, wireType) {
  return encodeVarint((fieldNumber << 3) | wireType);
}

function encodeFixed32Field(fieldNumber, value) {
  const body = Buffer.alloc(4);
  body.writeFloatLE(value, 0);
  return Buffer.concat([encodeTag(fieldNumber, 5), body]);
}

function encodeLengthDelimited(fieldNumber, body) {
  return Buffer.concat([encodeTag(fieldNumber, 2), encodeVarint(body.length), body]);
}

function encodeVarintField(fieldNumber, value) {
  return Buffer.concat([encodeTag(fieldNumber, 0), encodeVarint(value)]);
}

function encodeTimestampField(fieldNumber, seconds, nanos) {
  const parts = [];
  if (seconds !== 0) parts.push(encodeVarintField(1, seconds));
  if (nanos !== 0) parts.push(encodeVarintField(2, nanos));
  return encodeLengthDelimited(fieldNumber, Buffer.concat(parts));
}

function encodeCreditsInfo(shape) {
  const parts = [];
  if (shape.usageRatio !== undefined) parts.push(encodeFixed32Field(1, shape.usageRatio));
  if (shape.asOfSeconds !== undefined) {
    parts.push(encodeTimestampField(4, shape.asOfSeconds, shape.asOfNanos ?? 0));
  }
  if (shape.resetSeconds !== undefined) {
    parts.push(encodeTimestampField(5, shape.resetSeconds, shape.resetNanos ?? 0));
  }
  return Buffer.concat(parts);
}

function encodeTopLevelMessage(creditsInfo) {
  return encodeLengthDelimited(1, creditsInfo);
}

function frameData(payload) {
  const header = Buffer.alloc(5);
  header[0] = 0x00;
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

function frameTrailer(statusText = "grpc-status:0\r\n") {
  const body = Buffer.from(statusText, "utf8");
  const header = Buffer.alloc(5);
  header[0] = 0x80;
  header.writeUInt32BE(body.length, 1);
  return Buffer.concat([header, body]);
}

const REAL_USAGE_RATIO = 1.0;
const REAL_ASOF_SECONDS = 1784221140;
const REAL_ASOF_NANOS = 867850000;
const REAL_RESET_SECONDS = 1784825940;
const REAL_RESET_NANOS = 867850000;
const PERCENT_TOLERANCE = 1e-4;

function isoFromEpoch(seconds, nanos) {
  return new Date(seconds * 1000 + Math.round(nanos / 1_000_000)).toISOString();
}

describe("decodeGrokCreditsFrame", () => {
  it("decodes real GetGrokCreditsConfig shape (nested, fixed32, Timestamp, trailer)", () => {
    const creditsInfo = encodeCreditsInfo({
      usageRatio: REAL_USAGE_RATIO,
      asOfSeconds: REAL_ASOF_SECONDS,
      asOfNanos: REAL_ASOF_NANOS,
      resetSeconds: REAL_RESET_SECONDS,
      resetNanos: REAL_RESET_NANOS,
    });
    const buffer = Buffer.concat([frameData(encodeTopLevelMessage(creditsInfo)), frameTrailer()]);

    const result = decodeGrokCreditsFrame(buffer);
    expect(result).toBeTruthy();
    expect(result.percentUsed).toBe(100);
    expect(result.resetAt).toBe(isoFromEpoch(REAL_RESET_SECONDS, REAL_RESET_NANOS));
  });

  it("ignores trailing gRPC-web trailer frame (flag 0x80)", () => {
    const creditsInfo = encodeCreditsInfo({
      usageRatio: 0.5,
      resetSeconds: REAL_RESET_SECONDS,
      resetNanos: 0,
    });
    const topMessage = encodeTopLevelMessage(creditsInfo);
    const withoutTrailer = frameData(topMessage);
    const withTrailer = Buffer.concat([frameData(topMessage), frameTrailer()]);

    const a = decodeGrokCreditsFrame(withoutTrailer);
    const b = decodeGrokCreditsFrame(withTrailer);
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(b.percentUsed).toBe(a.percentUsed);
    expect(b.resetAt).toBe(a.resetAt);
    expect(b.percentUsed).toBe(50);
  });

  it("decodes raw unframed protobuf payload", () => {
    const creditsInfo = encodeCreditsInfo({
      usageRatio: 0.75,
      resetSeconds: REAL_RESET_SECONDS,
      resetNanos: REAL_RESET_NANOS,
    });
    const payload = encodeTopLevelMessage(creditsInfo);
    expect(probeFrameHeader(payload)).toBeNull();

    const result = decodeGrokCreditsFrame(payload);
    expect(result).toBeTruthy();
    expect(Math.abs(result.percentUsed - 75)).toBeLessThan(PERCENT_TOLERANCE);
    expect(result.resetAt).toBe(isoFromEpoch(REAL_RESET_SECONDS, REAL_RESET_NANOS));
  });

  it("treats omitted usage-ratio as 0% (proto3 default)", () => {
    const creditsInfo = encodeCreditsInfo({
      resetSeconds: REAL_RESET_SECONDS,
      resetNanos: REAL_RESET_NANOS,
    });
    const result = decodeGrokCreditsFrame(frameData(encodeTopLevelMessage(creditsInfo)));
    expect(result).toBeTruthy();
    expect(result.percentUsed).toBe(0);
    expect(result.resetAt).toBe(isoFromEpoch(REAL_RESET_SECONDS, REAL_RESET_NANOS));
  });

  it("clamps usage ratio above 1.0 to percentUsed 100", () => {
    const creditsInfo = encodeCreditsInfo({ usageRatio: 1.5 });
    const result = decodeGrokCreditsFrame(frameData(encodeTopLevelMessage(creditsInfo)));
    expect(result).toBeTruthy();
    expect(result.percentUsed).toBe(100);
  });

  it("returns null for negative usage ratio", () => {
    const creditsInfo = encodeCreditsInfo({ usageRatio: -0.1 });
    expect(decodeGrokCreditsFrame(frameData(encodeTopLevelMessage(creditsInfo)))).toBeNull();
  });

  it("returns null when top-level field 1 is not length-delimited", () => {
    expect(decodeGrokCreditsFrame(frameData(encodeVarintField(1, 42)))).toBeNull();
  });

  it("returns null when nested usage-ratio has unexpected wire type", () => {
    const creditsInfo = encodeLengthDelimited(1, Buffer.from("not-a-float", "utf8"));
    expect(decodeGrokCreditsFrame(frameData(encodeTopLevelMessage(creditsInfo)))).toBeNull();
  });

  it("returns null when top-level has no field 1", () => {
    expect(decodeGrokCreditsFrame(frameData(encodeVarintField(9, 1)))).toBeNull();
  });

  it("returns null for truncated buffer", () => {
    const creditsInfo = encodeCreditsInfo({
      usageRatio: 0.5,
      resetSeconds: REAL_RESET_SECONDS,
      resetNanos: REAL_RESET_NANOS,
    });
    const buffer = frameData(encodeTopLevelMessage(creditsInfo));
    expect(decodeGrokCreditsFrame(buffer.subarray(0, buffer.length - 3))).toBeNull();
  });

  it("returns null for trailer-only body", () => {
    expect(decodeGrokCreditsFrame(frameTrailer())).toBeNull();
  });

  it("returns null for empty buffer", () => {
    expect(decodeGrokCreditsFrame(Buffer.alloc(0))).toBeNull();
  });
});

describe("probeFrameHeader", () => {
  it("rejects declared length that exceeds body", () => {
    const header = Buffer.alloc(5);
    header[0] = 0x00;
    header.writeUInt32BE(9999, 1);
    expect(probeFrameHeader(Buffer.concat([header, Buffer.from([0x01, 0x02])]))).toBeNull();
  });

  it("rejects invalid compression flag", () => {
    const header = Buffer.alloc(5);
    header[0] = 0x07;
    expect(probeFrameHeader(header)).toBeNull();
  });

  it("accepts trailer frame header (flag 0x80)", () => {
    const result = probeFrameHeader(frameTrailer());
    expect(result).toBeTruthy();
    expect(result.flag).toBe(0x80);
  });

  it("reads frame header at non-zero offset", () => {
    const creditsInfo = encodeCreditsInfo({ usageRatio: 0.5 });
    const buffer = Buffer.concat([
      frameData(encodeTopLevelMessage(creditsInfo)),
      frameTrailer(),
    ]);
    const first = probeFrameHeader(buffer);
    expect(first).toBeTruthy();
    const second = probeFrameHeader(buffer, first.payloadStart + first.payloadLength);
    expect(second).toBeTruthy();
    expect(second.flag).toBe(0x80);
  });
});
