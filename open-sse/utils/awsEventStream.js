// AWS EventStream (application/vnd.amazon.eventstream) binary frame decoding.
//
// Extracted from executors/kiro.js so Bedrock's invoke-with-response-stream can
// reuse the same CRC-validated parser. Kiro keeps its own frame-splitting loop:
// that loop's value is its failure taxonomy (terminal_provenance, repair modes),
// which is Kiro-specific. Only the parser and its bounds are shared here.

const decoder = new TextDecoder();

export const EVENTSTREAM_MAX_MESSAGE_BYTES = 24 * 1024 * 1024;
export const EVENTSTREAM_MAX_HEADERS_BYTES = 128 * 1024;

const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return value >>> 0;
});

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Decode one complete frame: [totalLen 4B][headersLen 4B][preludeCRC 4B][headers][payload][messageCRC 4B]
 * Returns { headers, payload } with payload JSON-parsed (null when empty).
 * Throws on any CRC or bounds violation — callers decide how to surface that.
 */
export function parseEventFrame(data) {
  if (!(data instanceof Uint8Array) || data.byteLength < 16) {
    throw new Error("AWS EventStream frame is shorter than 16 bytes");
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const totalLength = view.getUint32(0, false);
  const headersLength = view.getUint32(4, false);
  if (totalLength !== data.byteLength) {
    throw new Error("AWS EventStream frame length does not match its prelude");
  }
  if (totalLength > EVENTSTREAM_MAX_MESSAGE_BYTES ||
      headersLength > EVENTSTREAM_MAX_HEADERS_BYTES ||
      headersLength > totalLength - 16) {
    throw new Error("AWS EventStream frame bounds are invalid");
  }
  if (view.getUint32(8, false) !== crc32(data.subarray(0, 8))) {
    throw new Error("AWS EventStream prelude CRC mismatch");
  }
  if (view.getUint32(totalLength - 4, false) !== crc32(data.subarray(0, totalLength - 4))) {
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
    if (names.has(name)) throw new Error(`AWS EventStream contains duplicate header: ${name}`);
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
      throw new Error(`AWS EventStream header ${name} has unknown type ${type}`);
    }
  }

  const payloadBytes = data.subarray(headerEnd, totalLength - 4);
  if (payloadBytes.byteLength === 0) return { headers, payload: null };
  const payloadText = decoder.decode(payloadBytes);
  if (!payloadText.trim()) return { headers, payload: null };
  try {
    return { headers, payload: JSON.parse(payloadText) };
  } catch (error) {
    throw new Error(`AWS EventStream payload is not valid JSON (${error.message})`);
  }
}

/**
 * Pull every complete frame out of `buffer`, returning the parsed events plus the
 * trailing partial bytes to carry into the next chunk.
 */
export function drainFrames(buffer) {
  const events = [];
  let rest = buffer;
  while (rest.byteLength >= 16) {
    const view = new DataView(rest.buffer, rest.byteOffset, rest.byteLength);
    const totalLength = view.getUint32(0, false);
    if (totalLength < 16 || totalLength > EVENTSTREAM_MAX_MESSAGE_BYTES) {
      throw new Error("AWS EventStream frame bounds are invalid");
    }
    if (rest.byteLength < totalLength) break;
    events.push(parseEventFrame(rest.slice(0, totalLength)));
    rest = rest.subarray(totalLength);
  }
  return { events, rest };
}
