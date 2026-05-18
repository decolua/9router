/**
 * Protobuf wire format codec — zero-dependency, schema-less.
 *
 * Wire types:
 *   0 = Varint    (int32, uint64, bool, enum)
 *   1 = Fixed64   (double, fixed64)
 *   2 = LenDelim  (string, bytes, embedded messages)
 *   5 = Fixed32   (float, fixed32)
 */

// ─── Varint ────────────────────────────────────────────────

export function encodeVarint(value) {
  const bytes = [];
  // BigInt path for negatives (two's-complement uint64) and any int > 2^31
  // since JS `>>>` truncates to uint32 and silently corrupts larger varints.
  if (typeof value === 'bigint' || value < 0 || value > 0x7FFFFFFF) {
    let b = (typeof value === 'bigint' ? value : BigInt(value)) & 0xFFFFFFFFFFFFFFFFn;
    while (true) {
      const byte = Number(b & 0x7Fn);
      b >>= 7n;
      if (b === 0n) { bytes.push(byte); break; }
      bytes.push(byte | 0x80);
    }
    return Buffer.from(bytes);
  }
  let v = Number(value);
  do {
    let byte = v & 0x7F;
    v >>>= 7;
    if (v > 0) byte |= 0x80;
    bytes.push(byte);
  } while (v > 0);
  return Buffer.from(bytes);
}

export function decodeVarint(buf, offset = 0) {
  // Fast path: read up to 4 bytes (28 bits) with plain int math — covers
  // all field tags and most small ints without touching BigInt. Fall through
  // to BigInt for anything larger so uint64 values (request_id, credit
  // counters, timestamps) decode accurately without sign/truncation bugs.
  let result = 0, shift = 0, pos = offset;
  while (pos < buf.length && shift < 28) {
    const byte = buf[pos++];
    result |= (byte & 0x7F) << shift;
    if (!(byte & 0x80)) return { value: result >>> 0, length: pos - offset };
    shift += 7;
  }
  if (pos >= buf.length) throw new Error('Truncated varint');
  // Continuation byte needed beyond 28 bits — switch to BigInt.
  let big = BigInt(result >>> 0);
  let bigShift = BigInt(shift);
  while (pos < buf.length) {
    const byte = buf[pos++];
    big |= BigInt(byte & 0x7F) << bigShift;
    if (!(byte & 0x80)) {
      // Return Number if safely representable, else BigInt.
      const asNum = Number(big);
      return { value: Number.isSafeInteger(asNum) ? asNum : big, length: pos - offset };
    }
    bigShift += 7n;
    if (bigShift >= 64n) throw new Error('Varint overflow');
  }
  throw new Error('Truncated varint');
}

// ─── Field-level writers (standalone functions) ────────────

function makeTag(field, wireType) {
  return encodeVarint((field << 3) | wireType);
}

/** Write a varint field (wire type 0). */
export function writeVarintField(field, value) {
  return Buffer.concat([makeTag(field, 0), encodeVarint(value)]);
}

/** Write a length-delimited string field (wire type 2). */
export function writeStringField(field, str) {
  if (!str && str !== '') return Buffer.alloc(0);
  const data = Buffer.from(str, 'utf-8');
  return Buffer.concat([makeTag(field, 2), encodeVarint(data.length), data]);
}

/** Write a length-delimited bytes field (wire type 2). */
export function writeBytesField(field, data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  return Buffer.concat([makeTag(field, 2), encodeVarint(buf.length), buf]);
}

/** Write an embedded message field (wire type 2). */
export function writeMessageField(field, msgBuf) {
  if (!msgBuf || msgBuf.length === 0) return Buffer.alloc(0);
  return Buffer.concat([makeTag(field, 2), encodeVarint(msgBuf.length), msgBuf]);
}

/** Write a fixed64 field (wire type 1). */
export function writeFixed64Field(field, buf8) {
  return Buffer.concat([makeTag(field, 1), buf8]);
}

/** Write a bool field (wire type 0), only if true. */
export function writeBoolField(field, value) {
  if (!value) return Buffer.alloc(0);
  return writeVarintField(field, 1);
}

// ─── Parser ────────────────────────────────────────────────

/**
 * Parse a protobuf buffer into an array of { field, wireType, value }.
 * For varint (0): value is a Number.
 * For lendelim (2): value is a Buffer (caller decides string vs message).
 * For fixed64 (1): value is an 8-byte Buffer.
 * For fixed32 (5): value is a 4-byte Buffer.
 */
export function parseFields(buf) {
  const fields = [];
  let pos = 0;
  while (pos < buf.length) {
    const tag = decodeVarint(buf, pos);
    pos += tag.length;
    const fieldNum = Number(tag.value) >>> 3;
    const wireType = Number(tag.value) & 0x07;

    let value;
    switch (wireType) {
      case 0: { // varint
        const v = decodeVarint(buf, pos);
        pos += v.length;
        value = v.value;
        break;
      }
      case 1: { // fixed64
        if (pos + 8 > buf.length) throw new Error(`truncated fixed64 at offset ${pos}`);
        value = buf.subarray(pos, pos + 8);
        pos += 8;
        break;
      }
      case 2: { // length-delimited
        const len = decodeVarint(buf, pos);
        pos += len.length;
        const sz = Number(len.value);
        if (sz < 0 || pos + sz > buf.length) {
          throw new Error(`truncated len-delim field ${fieldNum} at offset ${pos} (need ${sz}, have ${buf.length - pos})`);
        }
        value = buf.subarray(pos, pos + sz);
        pos += sz;
        break;
      }
      case 5: { // fixed32
        if (pos + 4 > buf.length) throw new Error(`truncated fixed32 at offset ${pos}`);
        value = buf.subarray(pos, pos + 4);
        pos += 4;
        break;
      }
      default:
        throw new Error(`Unknown wire type ${wireType} at offset ${pos}`);
    }
    fields.push({ field: fieldNum, wireType, value });
  }
  return fields;
}

/** Get first field matching number and optional wire type. */
export function getField(fields, num, wireType) {
  return fields.find(f => f.field === num && (wireType === undefined || f.wireType === wireType)) || null;
}

/** Get all fields matching number. */
export function getAllFields(fields, num) {
  return fields.filter(f => f.field === num);
}
