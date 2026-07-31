/**
 * gRPC-web frame decoder for xAI GetGrokCreditsConfig
 * (grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig).
 *
 * Real response shape (live capture 2026-07-20):
 *   top-level field 1 (length-delimited) — nested credits info
 *     subfield 1  (fixed32 float)            — usage ratio 0..1
 *     subfield 5  (Timestamp{seconds,nanos}) — credit-pool reset time
 *
 * Fail-open: any malformed buffer returns null, never throws.
 */

const FIELD_CREDITS_INFO = 1;
const CREDITS_FIELD_USAGE_RATIO = 1;
const CREDITS_FIELD_RESET_TIMESTAMP = 5;
const TIMESTAMP_FIELD_SECONDS = 1;
const TIMESTAMP_FIELD_NANOS = 2;

const WIRE_TYPE_VARINT = 0;
const WIRE_TYPE_FIXED64 = 1;
const WIRE_TYPE_LENGTH_DELIMITED = 2;
const WIRE_TYPE_FIXED32 = 5;

const GRPC_WEB_TRAILER_FLAG_BIT = 0x80;
const MAX_VARINT_SHIFT_BITS = 70n;

/**
 * Validate a gRPC-web frame header at `offset`.
 * @returns {{ flag: number, payloadStart: number, payloadLength: number } | null}
 */
export function probeFrameHeader(buffer, offset = 0) {
  if (!Buffer.isBuffer(buffer) || offset < 0 || buffer.length - offset < 5) return null;
  const flag = buffer[offset];
  if (flag !== 0x00 && flag !== 0x01 && flag !== 0x80 && flag !== 0x81) return null;
  const payloadStart = offset + 5;
  const payloadLength = buffer.readUInt32BE(offset + 1);
  if (payloadLength > buffer.length - payloadStart) return null;
  return { flag, payloadStart, payloadLength };
}

function readVarint(buffer, offset) {
  let result = 0n;
  let shift = 0n;
  let pos = offset;
  for (;;) {
    if (pos >= buffer.length) return null;
    const byte = buffer[pos];
    result |= BigInt(byte & 0x7f) << shift;
    pos += 1;
    if ((byte & 0x80) === 0) break;
    shift += 7n;
    if (shift > MAX_VARINT_SHIFT_BITS) return null;
  }
  return { value: Number(result), next: pos };
}

function readLengthDelimitedField(buffer, offset) {
  const lengthResult = readVarint(buffer, offset);
  if (!lengthResult) return null;
  const { value: length, next: bodyStart } = lengthResult;
  if (length < 0 || bodyStart + length > buffer.length) return null;
  return {
    field: { wireType: WIRE_TYPE_LENGTH_DELIMITED, bytes: buffer.subarray(bodyStart, bodyStart + length) },
    next: bodyStart + length,
  };
}

function readFixedWidthField(buffer, offset, width, wireType) {
  if (offset + width > buffer.length) return null;
  return {
    field: { wireType, bytes: buffer.subarray(offset, offset + width) },
    next: offset + width,
  };
}

function readField(buffer, offset) {
  const tagResult = readVarint(buffer, offset);
  if (!tagResult) return null;
  const fieldNumber = tagResult.value >>> 3;
  const wireType = tagResult.value & 0x7;
  if (fieldNumber === 0) return null;

  if (wireType === WIRE_TYPE_VARINT) {
    const valueResult = readVarint(buffer, tagResult.next);
    if (!valueResult) return null;
    return {
      fieldNumber,
      field: { wireType: WIRE_TYPE_VARINT, value: valueResult.value },
      next: valueResult.next,
    };
  }
  if (wireType === WIRE_TYPE_LENGTH_DELIMITED) {
    const result = readLengthDelimitedField(buffer, tagResult.next);
    return result ? { fieldNumber, field: result.field, next: result.next } : null;
  }
  if (wireType === WIRE_TYPE_FIXED64) {
    const result = readFixedWidthField(buffer, tagResult.next, 8, WIRE_TYPE_FIXED64);
    return result ? { fieldNumber, field: result.field, next: result.next } : null;
  }
  if (wireType === WIRE_TYPE_FIXED32) {
    const result = readFixedWidthField(buffer, tagResult.next, 4, WIRE_TYPE_FIXED32);
    return result ? { fieldNumber, field: result.field, next: result.next } : null;
  }
  return null;
}

function decodeFields(buffer) {
  const fields = new Map();
  let offset = 0;
  while (offset < buffer.length) {
    const result = readField(buffer, offset);
    if (!result) return null;
    fields.set(result.fieldNumber, result.field);
    offset = result.next;
  }
  return fields;
}

function findDataFramePayload(buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const frame = probeFrameHeader(buffer, offset);
    if (!frame) return null;
    const frameEnd = frame.payloadStart + frame.payloadLength;
    const isTrailer = (frame.flag & GRPC_WEB_TRAILER_FLAG_BIT) !== 0;
    if (!isTrailer) {
      return buffer.subarray(frame.payloadStart, frameEnd);
    }
    offset = frameEnd;
  }
  return null;
}

function extractNestedMessage(field) {
  if (!field || field.wireType !== WIRE_TYPE_LENGTH_DELIMITED) return null;
  return decodeFields(field.bytes);
}

function extractUsageRatio(field) {
  if (!field) return 0; // proto3 omission = 0% used
  if (field.wireType === WIRE_TYPE_FIXED32) return field.bytes.readFloatLE(0);
  if (field.wireType === WIRE_TYPE_FIXED64) return field.bytes.readDoubleLE(0);
  return null;
}

function extractResetAt(field) {
  if (!field || field.wireType !== WIRE_TYPE_LENGTH_DELIMITED) return null;

  const timestampFields = decodeFields(field.bytes);
  if (!timestampFields) return null;

  const secondsField = timestampFields.get(TIMESTAMP_FIELD_SECONDS);
  const nanosField = timestampFields.get(TIMESTAMP_FIELD_NANOS);
  const seconds = secondsField?.wireType === WIRE_TYPE_VARINT ? secondsField.value : 0;
  const nanos = nanosField?.wireType === WIRE_TYPE_VARINT ? nanosField.value : 0;

  const millis = seconds * 1000 + Math.round(nanos / 1_000_000);
  const parsed = new Date(millis);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Decode GetGrokCreditsConfig response → `{ percentUsed: 0-100, resetAt }` or null.
 * @param {Buffer} buffer
 * @returns {{ percentUsed: number, resetAt: string|null } | null}
 */
export function decodeGrokCreditsFrame(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) return null;

  try {
    const framed = probeFrameHeader(buffer, 0) !== null;
    const payload = framed ? findDataFramePayload(buffer) : buffer;
    if (!payload) return null;

    const topLevelFields = decodeFields(payload);
    if (!topLevelFields) return null;

    const creditsInfo = extractNestedMessage(topLevelFields.get(FIELD_CREDITS_INFO));
    if (!creditsInfo) return null;

    const usageRatio = extractUsageRatio(creditsInfo.get(CREDITS_FIELD_USAGE_RATIO));
    if (usageRatio === null || !Number.isFinite(usageRatio) || usageRatio < 0) return null;

    return {
      percentUsed: Math.min(100, usageRatio * 100),
      resetAt: extractResetAt(creditsInfo.get(CREDITS_FIELD_RESET_TIMESTAMP)),
    };
  } catch {
    return null;
  }
}
