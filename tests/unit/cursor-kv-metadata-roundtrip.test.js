import { describe, expect, it } from "vitest";
import { encodeKvClientMessage } from "../../open-sse/executors/cursor.js";
import {
  decodeMessage,
  encodeField,
  parseConnectRPCFrame,
} from "../../open-sse/utils/cursorProtobuf.js";

// KvServerMessage asks the client to get (field 2) or set (field 3) a blob.
// The ack frame MUST echo the server's metadata (field 4) verbatim — dropping
// it desynchronises AgentService session state. These tests lock that
// round-trip so a refactor cannot silently regress it (the echo was missing
// before c933eefc and had no coverage).
const PROTOBUF_LEN = 2;
const PROTOBUF_VARINT = 0;

function encodeBytes(field, bytes) {
  return encodeField(field, PROTOBUF_LEN, bytes);
}

function buildKvServerMessage(kvId, variantField, metadata) {
  // Server-side fixture: KvServerMessage with id (field 1), get (2) or set (3)
  // variant, and metadata (field 4), exactly as decodeAgentKvServerEvent reads.
  const fields = [];
  if (kvId) fields.push(encodeField(1, PROTOBUF_VARINT, kvId));
  fields.push(encodeBytes(variantField, new Uint8Array()));
  if (metadata?.length) fields.push(encodeBytes(4, metadata));
  const out = new Uint8Array(fields.reduce((n, f) => n + f.length, 0));
  let offset = 0;
  for (const f of fields) {
    out.set(f, offset);
    offset += f.length;
  }
  return out;
}

function decodeKvClientFrame(frame) {
  const parsed = parseConnectRPCFrame(frame);
  expect(parsed).toBeTruthy();
  const clientMessage = decodeMessage(parsed.payload);
  // AgentStreamClientMessage.agent (field 3) carries the KvClientMessage.
  const agent = clientMessage.get(3)?.[0];
  expect(agent?.wireType).toBe(PROTOBUF_LEN);
  return { kv: decodeMessage(agent.value), raw: agent.value };
}

function serverMetadata(serverFrame) {
  return decodeMessage(serverFrame).get(4)?.[0]?.value || null;
}

describe("encodeKvClientMessage metadata round-trip", () => {
  it("echoes metadata (field 4) on a get ack", () => {
    const metadata = new TextEncoder().encode("checkpoint-turn-42");
    const server = buildKvServerMessage(7, 2, metadata);
    const ack = encodeKvClientMessage(7, 2, new Uint8Array(0), serverMetadata(server));
    const { kv } = decodeKvClientFrame(ack);
    expect(kv.get(1)?.[0]?.value).toBe(7);
    expect(kv.has(2)).toBe(true);
    expect(Buffer.from(kv.get(4)?.[0]?.value).toString("utf8")).toBe("checkpoint-turn-42");
  });

  it("echoes metadata (field 4) on a set ack", () => {
    const metadata = new TextEncoder().encode("blob-lineage-v1");
    const server = buildKvServerMessage(3, 3, metadata);
    const ack = encodeKvClientMessage(3, 3, new Uint8Array(0), serverMetadata(server));
    const { kv } = decodeKvClientFrame(ack);
    expect(kv.get(1)?.[0]?.value).toBe(3);
    expect(kv.has(3)).toBe(true);
    expect(Buffer.from(kv.get(4)?.[0]?.value).toString("utf8")).toBe("blob-lineage-v1");
  });

  it("omits field 4 when the server frame carried no metadata", () => {
    const server = buildKvServerMessage(9, 2, null);
    const ack = encodeKvClientMessage(9, 2, new Uint8Array(0), serverMetadata(server));
    const { kv } = decodeKvClientFrame(ack);
    expect(kv.has(4)).toBe(false);
  });

  it("preserves arbitrary binary metadata bytes", () => {
    const metadata = new Uint8Array([0, 255, 1, 0, 128, 127, 255, 254]);
    const server = buildKvServerMessage(11, 2, metadata);
    const ack = encodeKvClientMessage(11, 2, new Uint8Array(0), serverMetadata(server));
    const { kv } = decodeKvClientFrame(ack);
    expect(new Uint8Array(kv.get(4)?.[0]?.value)).toEqual(metadata);
  });

  it("keeps field order stable: id, variant, metadata", () => {
    const metadata = new TextEncoder().encode("order");
    const server = buildKvServerMessage(5, 2, metadata);
    const ack = encodeKvClientMessage(5, 2, new Uint8Array(0), serverMetadata(server));
    const { raw } = decodeKvClientFrame(ack);
    // Walk raw bytes: field 1 varint key 0x08, field 2 len key 0x12,
    // then field 4 len key 0x22 directly before the metadata payload.
    expect(raw[0]).toBe((1 << 3) | PROTOBUF_VARINT);
    expect(raw[1]).toBe(5);
    expect(raw[2]).toBe((2 << 3) | PROTOBUF_LEN);
    expect(raw[raw.length - metadata.length - 2]).toBe((4 << 3) | PROTOBUF_LEN);
  });

  it("round-trips a payload-bearing get ack", () => {
    const blob = new TextEncoder().encode("conversation-state");
    const metadata = new TextEncoder().encode("m");
    const getResult = encodeBytes(1, blob); // GetResult.blob (field 1)
    const ack = encodeKvClientMessage(21, 2, getResult, metadata);
    const { kv } = decodeKvClientFrame(ack);
    const inner = decodeMessage(kv.get(2)[0].value);
    expect(Buffer.from(inner.get(1)?.[0]?.value).toString("utf8")).toBe("conversation-state");
    expect(Buffer.from(kv.get(4)?.[0]?.value).toString("utf8")).toBe("m");
  });
});
