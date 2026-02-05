/**
 * Cursor Protobuf Encoding/Decoding Utility
 *
 * Implements protobuf wire format encoding for Cursor API requests
 * and decoding for streaming responses.
 *
 * Wire format reference:
 * - Wire type 0: Varint (int32, int64, uint32, uint64, bool, enum)
 * - Wire type 2: Length-delimited (string, bytes, embedded messages)
 */

import { v4 as uuidv4 } from "uuid";
import zlib from "zlib";

// =============================================================================
// Encoding Functions
// =============================================================================

/**
 * Encode an integer as a varint
 * @param {number} value - Integer to encode
 * @returns {Uint8Array} - Encoded bytes
 */
export function encodeVarint(value) {
  const bytes = [];
  while (value >= 0x80) {
    bytes.push((value & 0x7F) | 0x80);
    value >>>= 7;
  }
  bytes.push(value & 0x7F);
  return new Uint8Array(bytes);
}

/**
 * Encode a protobuf field
 * @param {number} fieldNum - Field number
 * @param {number} wireType - Wire type (0=varint, 2=length-delimited)
 * @param {*} value - Value to encode
 * @returns {Uint8Array} - Encoded bytes
 */
export function encodeField(fieldNum, wireType, value) {
  const tag = (fieldNum << 3) | wireType;
  const tagBytes = encodeVarint(tag);

  if (wireType === 0) {
    // Varint
    const valueBytes = encodeVarint(value);
    const result = new Uint8Array(tagBytes.length + valueBytes.length);
    result.set(tagBytes);
    result.set(valueBytes, tagBytes.length);
    return result;
  } else if (wireType === 2) {
    // Length-delimited (string, bytes, nested message)
    let dataBytes;
    if (typeof value === "string") {
      dataBytes = new TextEncoder().encode(value);
    } else if (value instanceof Uint8Array) {
      dataBytes = value;
    } else if (Buffer.isBuffer(value)) {
      dataBytes = new Uint8Array(value);
    } else {
      dataBytes = new Uint8Array(0);
    }

    const lengthBytes = encodeVarint(dataBytes.length);
    const result = new Uint8Array(tagBytes.length + lengthBytes.length + dataBytes.length);
    result.set(tagBytes);
    result.set(lengthBytes, tagBytes.length);
    result.set(dataBytes, tagBytes.length + lengthBytes.length);
    return result;
  }

  return new Uint8Array(0);
}

/**
 * Concatenate multiple Uint8Arrays
 * @param  {...Uint8Array} arrays - Arrays to concatenate
 * @returns {Uint8Array} - Concatenated array
 */
function concatArrays(...arrays) {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * Encode a Message (conversation message)
 *
 * Schema:
 *   string content = 1;
 *   int32 role = 2;
 *   string messageId = 13;
 *   int32 chatModeEnum = 47; (only for user)
 */
export function encodeMessage(content, role, messageId, chatModeEnum = null) {
  const parts = [];

  // Field 1: content (string)
  parts.push(encodeField(1, 2, content));

  // Field 2: role (int32) - 1=user, 2=assistant
  parts.push(encodeField(2, 0, role));

  // Field 13: messageId (string)
  parts.push(encodeField(13, 2, messageId));

  // Field 47: chatModeEnum (only for user messages)
  if (chatModeEnum !== null) {
    parts.push(encodeField(47, 0, chatModeEnum));
  }

  return concatArrays(...parts);
}

/**
 * Encode Instruction message
 * Schema: string instruction = 1;
 */
export function encodeInstruction(instructionText) {
  if (!instructionText) return new Uint8Array(0);
  return encodeField(1, 2, instructionText);
}

/**
 * Encode Model message
 * Schema:
 *   string name = 1;
 *   bytes empty = 4;
 */
export function encodeModel(modelName) {
  return concatArrays(
    encodeField(1, 2, modelName),
    encodeField(4, 2, new Uint8Array(0))
  );
}

/**
 * Encode CursorSetting message
 */
export function encodeCursorSetting() {
  // Unknown6 nested message
  const unknown6 = concatArrays(
    encodeField(1, 2, new Uint8Array(0)),
    encodeField(2, 2, new Uint8Array(0))
  );

  return concatArrays(
    encodeField(1, 2, "cursor\\aisettings"),
    encodeField(3, 2, new Uint8Array(0)),
    encodeField(6, 2, unknown6),
    encodeField(8, 0, 1),
    encodeField(9, 0, 1)
  );
}

/**
 * Encode Metadata message
 */
export function encodeMetadata() {
  return concatArrays(
    encodeField(1, 2, process.platform || "linux"),
    encodeField(2, 2, process.arch || "x64"),
    encodeField(3, 2, process.version || "v20.0.0"),
    encodeField(4, 2, process.cwd?.() || "/"),
    encodeField(5, 2, new Date().toISOString())
  );
}

/**
 * Encode MessageId message
 */
export function encodeMessageId(messageId, role, summaryId = null) {
  const parts = [
    encodeField(1, 2, messageId),
  ];

  if (summaryId) {
    parts.push(encodeField(2, 2, summaryId));
  }

  parts.push(encodeField(3, 0, role));

  return concatArrays(...parts);
}

/**
 * Encode the Request message (inner request)
 */
export function encodeRequest(messages, modelName) {
  const parts = [];
  const formattedMessages = [];
  const messageIds = [];

  // Format messages
  for (const msg of messages) {
    const role = msg.role === "user" ? 1 : 2;
    const msgId = uuidv4();

    formattedMessages.push({
      content: msg.content,
      role,
      messageId: msgId,
      chatModeEnum: role === 1 ? 1 : null // Only for user messages
    });

    messageIds.push({ messageId: msgId, role });
  }

  // Field 1: repeated Message messages
  for (const fm of formattedMessages) {
    const messageBytes = encodeMessage(fm.content, fm.role, fm.messageId, fm.chatModeEnum);
    parts.push(encodeField(1, 2, messageBytes));
  }

  // Field 2: unknown2 = 1
  parts.push(encodeField(2, 0, 1));

  // Field 3: Instruction
  parts.push(encodeField(3, 2, encodeInstruction("")));

  // Field 4: unknown4 = 1
  parts.push(encodeField(4, 0, 1));

  // Field 5: Model - always send, even for "default"
  if (modelName) {
    parts.push(encodeField(5, 2, encodeModel(modelName)));
  }

  // Field 8: webTool = ""
  parts.push(encodeField(8, 2, ""));

  // Field 13: unknown13 = 1
  parts.push(encodeField(13, 0, 1));

  // Field 15: CursorSetting
  parts.push(encodeField(15, 2, encodeCursorSetting()));

  // Field 19: unknown19 = 1
  parts.push(encodeField(19, 0, 1));

  // Field 23: conversationId
  parts.push(encodeField(23, 2, uuidv4()));

  // Field 26: Metadata
  parts.push(encodeField(26, 2, encodeMetadata()));

  // Field 27: unknown27 = 0
  parts.push(encodeField(27, 0, 0));

  // Field 30: repeated MessageId
  for (const mid of messageIds) {
    parts.push(encodeField(30, 2, encodeMessageId(mid.messageId, mid.role)));
  }

  // Field 35: largeContext = 0
  parts.push(encodeField(35, 0, 0));

  // Field 38: unknown38 = 0
  parts.push(encodeField(38, 0, 0));

  // Field 46: chatModeEnum = 1
  parts.push(encodeField(46, 0, 1));

  // Field 47: unknown47 = ""
  parts.push(encodeField(47, 2, ""));

  // Field 48-51, 53
  parts.push(encodeField(48, 0, 0));
  parts.push(encodeField(49, 0, 0));
  parts.push(encodeField(51, 0, 0));
  parts.push(encodeField(53, 0, 1));

  // Field 54: chatMode = "Ask"
  parts.push(encodeField(54, 2, "Ask"));

  return concatArrays(...parts);
}

/**
 * Build the full StreamUnifiedChatWithToolsRequest
 */
export function buildChatRequest(messages, modelName) {
  // Field 1: Request request
  const requestBytes = encodeRequest(messages, modelName);
  return encodeField(1, 2, requestBytes);
}

/**
 * Wrap payload with ConnectRPC frame header
 *
 * Frame format: [flags:1][length:4][payload]
 * - flags: 0x00 = uncompressed, 0x01 = gzip compressed
 * - length: big-endian 32-bit length
 *
 * @param {Uint8Array} payload - Protobuf payload
 * @param {boolean} compress - Whether to gzip compress (for messages >= 3)
 * @returns {Uint8Array} - Framed data
 */
export function wrapConnectRPCFrame(payload, compress = false) {
  let finalPayload = payload;
  let flags = 0x00;

  if (compress) {
    finalPayload = new Uint8Array(zlib.gzipSync(Buffer.from(payload)));
    flags = 0x01;
  }

  // Create frame: [flags:1][length:4][payload]
  const frame = new Uint8Array(5 + finalPayload.length);
  frame[0] = flags;

  // Big-endian length
  const length = finalPayload.length;
  frame[1] = (length >> 24) & 0xFF;
  frame[2] = (length >> 16) & 0xFF;
  frame[3] = (length >> 8) & 0xFF;
  frame[4] = length & 0xFF;

  frame.set(finalPayload, 5);
  return frame;
}

/**
 * Generate complete Cursor request body
 * @param {Array} messages - Array of {role, content} messages
 * @param {string} modelName - Model name
 * @returns {Uint8Array} - Complete request body
 */
export function generateCursorBody(messages, modelName) {
  const protobuf = buildChatRequest(messages, modelName);

  // Compress if >= 3 messages
  const shouldCompress = messages.length >= 3;
  return wrapConnectRPCFrame(protobuf, shouldCompress);
}

// =============================================================================
// Decoding Functions
// =============================================================================

/**
 * Decode a varint from buffer
 * @param {Uint8Array} buffer - Input buffer
 * @param {number} offset - Start offset
 * @returns {[number, number]} - [value, newOffset]
 */
export function decodeVarint(buffer, offset) {
  let result = 0;
  let shift = 0;
  let pos = offset;

  while (pos < buffer.length) {
    const b = buffer[pos];
    result |= (b & 0x7F) << shift;
    pos++;
    if (!(b & 0x80)) break;
    shift += 7;
  }

  return [result, pos];
}

/**
 * Decode a single protobuf field
 * @param {Uint8Array} buffer - Input buffer
 * @param {number} offset - Start offset
 * @returns {[number, number, any, number]} - [fieldNum, wireType, value, newOffset]
 */
export function decodeField(buffer, offset) {
  if (offset >= buffer.length) {
    return [null, null, null, offset];
  }

  const [tag, pos1] = decodeVarint(buffer, offset);
  const fieldNum = tag >> 3;
  const wireType = tag & 0x07;

  let value;
  let pos = pos1;

  if (wireType === 0) {
    // Varint
    [value, pos] = decodeVarint(buffer, pos);
  } else if (wireType === 2) {
    // Length-delimited
    const [length, pos2] = decodeVarint(buffer, pos);
    value = buffer.slice(pos2, pos2 + length);
    pos = pos2 + length;
  } else if (wireType === 1) {
    // Fixed64
    value = buffer.slice(pos, pos + 8);
    pos += 8;
  } else if (wireType === 5) {
    // Fixed32
    value = buffer.slice(pos, pos + 4);
    pos += 4;
  } else {
    value = null;
  }

  return [fieldNum, wireType, value, pos];
}

/**
 * Decode all fields from a protobuf message
 * @param {Uint8Array} data - Protobuf data
 * @returns {Map<number, Array>} - Map of fieldNum -> [{wireType, value}]
 */
export function decodeMessage(data) {
  const fields = new Map();
  let pos = 0;

  while (pos < data.length) {
    const [fieldNum, wireType, value, newPos] = decodeField(data, pos);
    if (fieldNum === null) break;

    if (!fields.has(fieldNum)) {
      fields.set(fieldNum, []);
    }
    fields.get(fieldNum).push({ wireType, value });
    pos = newPos;
  }

  return fields;
}

/**
 * Parse ConnectRPC frame
 * @param {Uint8Array} buffer - Input buffer
 * @returns {{flags: number, length: number, payload: Uint8Array, consumed: number} | null}
 */
export function parseConnectRPCFrame(buffer) {
  if (buffer.length < 5) return null;

  const flags = buffer[0];
  const length = (buffer[1] << 24) | (buffer[2] << 16) | (buffer[3] << 8) | buffer[4];

  if (buffer.length < 5 + length) return null;

  let payload = buffer.slice(5, 5 + length);

  // Decompress if gzip flag is set
  if (flags === 0x01) {
    try {
      payload = new Uint8Array(zlib.gunzipSync(Buffer.from(payload)));
    } catch {
      // Decompression failed, return raw
    }
  }

  return {
    flags,
    length,
    payload,
    consumed: 5 + length
  };
}

/**
 * Extract text content or error from response protobuf
 *
 * Response structure (from cursor-grpc/server_full.proto):
 *
 * message StreamUnifiedChatResponseWithTools {
 *   oneof response {
 *     ClientSideToolV2Call client_side_tool_v2_call = 1;
 *     StreamUnifiedChatResponse stream_unified_chat_response = 2;
 *   }
 * }
 *
 * message StreamUnifiedChatResponse {
 *   string text = 1;  // <-- THE TEXT WE NEED
 * }
 *
 * @param {Uint8Array} payload - Decoded protobuf payload
 * @returns {{text: string|null, error: string|null}} - Extracted content
 */
export function extractTextFromResponse(payload) {
  try {
    const fields = decodeMessage(payload);

    // Field 2 = StreamUnifiedChatResponse (contains the text)
    if (fields.has(2)) {
      for (const { wireType, value } of fields.get(2)) {
        if (wireType === 2) {
          // Decode nested StreamUnifiedChatResponse
          try {
            const nested = decodeMessage(value);

            // Field 1 = text (string)
            if (nested.has(1)) {
              for (const { wireType: nwt, value: nv } of nested.get(1)) {
                if (nwt === 2) {
                  try {
                    const text = new TextDecoder().decode(nv);
                    // Return any non-empty text
                    if (text && text.length > 0) {
                      return { text, error: null };
                    }
                  } catch {}
                }
              }
            }
          } catch {}
        }
      }
    }

    // Field 1 could be ClientSideToolV2Call (skip for now)
    // Field 3 could be ConversationSummary (skip for now)

    return { text: null, error: null };
  } catch {
    return { text: null, error: null };
  }
}

export default {
  // Encoding
  encodeVarint,
  encodeField,
  encodeMessage,
  buildChatRequest,
  wrapConnectRPCFrame,
  generateCursorBody,

  // Decoding
  decodeVarint,
  decodeField,
  decodeMessage,
  parseConnectRPCFrame,
  extractTextFromResponse
};
