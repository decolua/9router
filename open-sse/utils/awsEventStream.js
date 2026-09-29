import { AWS_EVENTSTREAM } from "../config/awsConstants.js";

/**
 * AWS EventStream binary framing: CRC32 and single-frame decoding.
 *
 * Extracted verbatim from executors/kiro.js, which hardened this against malformed frames.
 * Bedrock's invoke-with-response-stream uses the identical framing, and keeping one
 * implementation means a bounds or CRC fix cannot land in only half of the codebase.
 *
 * Frame layout: [totalLength u32][headersLength u32][preludeCrc u32][headers][payload][messageCrc u32]
 */

const decoder = new TextDecoder();

const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return value >>> 0;
});

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes)
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Decode one complete frame. Throws on any integrity failure rather than returning partial
 * data, because a silently truncated frame becomes a silently truncated model response.
 *
 * @param {Uint8Array} data - Exactly one frame, totalLength bytes long.
 * @param {object} [limits]
 * @returns {{headers: object, payload: object|null}}
 */
export function parseEventFrame(data, limits = AWS_EVENTSTREAM) {
  const maxMessageBytes =
    limits.maxMessageBytes ?? AWS_EVENTSTREAM.maxMessageBytes;
  const maxHeadersBytes =
    limits.maxHeadersBytes ?? AWS_EVENTSTREAM.maxHeadersBytes;

  if (!(data instanceof Uint8Array) || data.byteLength < 16) {
    throw new Error("AWS EventStream frame is shorter than 16 bytes");
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const totalLength = view.getUint32(0, false);
  const headersLength = view.getUint32(4, false);
  if (totalLength !== data.byteLength) {
    throw new Error("AWS EventStream frame length does not match its prelude");
  }
  if (
    totalLength > maxMessageBytes ||
    headersLength > maxHeadersBytes ||
    headersLength > totalLength - 16
  ) {
    throw new Error("AWS EventStream frame bounds are invalid");
  }
  if (view.getUint32(8, false) !== crc32(data.subarray(0, 8))) {
    throw new Error("AWS EventStream prelude CRC mismatch");
  }
  if (
    view.getUint32(totalLength - 4, false) !==
    crc32(data.subarray(0, totalLength - 4))
  ) {
    throw new Error("AWS EventStream message CRC mismatch");
  }

  const headers = Object.create(null);
  const names = new Set();
  let offset = 12;
  const headerEnd = offset + headersLength;
  const requireBytes = (count) => {
    if (offset + count > headerEnd) {
      throw new Error("AWS EventStream header exceeds its declared bounds");
    }
  };

  while (offset < headerEnd) {
    requireBytes(1);
    const nameLength = data[offset++];
    requireBytes(nameLength + 1);
    const name = decoder.decode(data.subarray(offset, offset + nameLength));
    offset += nameLength;
    if (names.has(name))
      throw new Error(`AWS EventStream contains duplicate header: ${name}`);
    names.add(name);
    const type = data[offset++];

    if (type === 0 || type === 1) {
      headers[name] = type === 0;
    } else if (type === 2) {
      requireBytes(1);
      headers[name] = view.getInt8(offset);
      offset += 1;
    } else if (type === 3) {
      requireBytes(2);
      headers[name] = view.getInt16(offset, false);
      offset += 2;
    } else if (type === 4) {
      requireBytes(4);
      headers[name] = view.getInt32(offset, false);
      offset += 4;
    } else if (type === 5 || type === 8) {
      requireBytes(8);
      offset += 8;
    } else if (type === 6 || type === 7) {
      requireBytes(2);
      const valueLength = view.getUint16(offset, false);
      offset += 2;
      requireBytes(valueLength);
      const bytes = data.subarray(offset, offset + valueLength);
      headers[name] = type === 7 ? decoder.decode(bytes) : bytes;
      offset += valueLength;
    } else if (type === 9) {
      requireBytes(16);
      offset += 16;
    } else {
      throw new Error(
        `AWS EventStream header ${name} has unknown type ${type}`,
      );
    }
  }

  const payloadBytes = data.subarray(headerEnd, totalLength - 4);
  if (payloadBytes.byteLength === 0) return { headers, payload: null };
  const payloadText = decoder.decode(payloadBytes);
  if (!payloadText.trim()) return { headers, payload: null };
  try {
    return { headers, payload: JSON.parse(payloadText) };
  } catch (error) {
    throw new Error(
      `AWS EventStream payload is not valid JSON (${error.message})`,
    );
  }
}

/**
 * Build one frame. Only used by tests and fixtures — nothing in the request path emits
 * EventStream — but it lives here so encode and decode stay in step.
 *
 * @param {object} headers - String-valued headers, written as type 7 (string).
 * @param {object|null} payload - JSON-serialisable payload.
 * @returns {Uint8Array}
 */
export function encodeEventFrame(headers = {}, payload = null) {
  const encoder = new TextEncoder();
  const headerChunks = Object.entries(headers).map(([name, value]) => {
    const nameBytes = encoder.encode(name);
    const valueBytes = encoder.encode(String(value));
    const chunk = new Uint8Array(
      1 + nameBytes.length + 1 + 2 + valueBytes.length,
    );
    const chunkView = new DataView(chunk.buffer);
    let cursor = 0;
    chunk[cursor++] = nameBytes.length;
    chunk.set(nameBytes, cursor);
    cursor += nameBytes.length;
    chunk[cursor++] = 7; // string
    chunkView.setUint16(cursor, valueBytes.length, false);
    cursor += 2;
    chunk.set(valueBytes, cursor);
    return chunk;
  });

  const headersLength = headerChunks.reduce(
    (sum, chunk) => sum + chunk.length,
    0,
  );
  const payloadBytes =
    payload === null
      ? new Uint8Array(0)
      : encoder.encode(JSON.stringify(payload));
  const totalLength = 16 + headersLength + payloadBytes.length;

  const frame = new Uint8Array(totalLength);
  const view = new DataView(frame.buffer);
  view.setUint32(0, totalLength, false);
  view.setUint32(4, headersLength, false);
  view.setUint32(8, crc32(frame.subarray(0, 8)), false);

  let offset = 12;
  for (const chunk of headerChunks) {
    frame.set(chunk, offset);
    offset += chunk.length;
  }
  frame.set(payloadBytes, offset);
  view.setUint32(
    totalLength - 4,
    crc32(frame.subarray(0, totalLength - 4)),
    false,
  );
  return frame;
}
