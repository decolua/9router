import { gunzipSync } from "node:zlib";
import { buildUserJwtRequest, DEVIN_HOST, DEVIN_MODEL_CONFIG_PATH } from "../executors/devin.js";

const DEFAULT_CONTEXT_WINDOW = 200_000;
const DEFAULT_MAX_TOKENS = 64_000;
const DISCOVERY_TIMEOUT_MS = 5_000;
const REASONING_LABEL = /think|thinking|minimal|high|medium|low|xhigh|max|reasoning/i;
const NO_REASONING_LABEL = /\bno thinking\b/i;

export async function discoverDevinModels(apiKey, { signal, fetchImpl = fetch } = {}) {
  const timeout = AbortSignal.timeout(DISCOVERY_TIMEOUT_MS);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetchImpl(`${DEVIN_HOST}${DEVIN_MODEL_CONFIG_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/proto", "connect-protocol-version": "1", accept: "*/*" },
    body: buildUserJwtRequest(apiKey),
    signal: requestSignal,
  });
  if (!response.ok) throw new Error(`Devin model discovery failed: ${response.status}`);
  return decodeDiscoveredDevinModels(Buffer.from(await response.arrayBuffer()));
}

export function decodeDiscoveredDevinModels(payload) {
  let bytes = Buffer.from(payload);
  try {
    return normalizeConfigs(decodeFields(bytes).filter((field) => field.number === 1 && field.wire === 2).map((field) => field.value));
  } catch {
    bytes = gunzipSync(bytes);
    return normalizeConfigs(decodeFields(bytes).filter((field) => field.number === 1 && field.wire === 2).map((field) => field.value));
  }
}

function normalizeConfigs(configs) {
  const models = new Map();
  for (const config of configs) {
    const values = new Map(decodeFields(config).map((field) => [field.number, field]));
    const id = fieldText(values.get(22)?.value).trim();
    if (!id || fieldNumber(values.get(4)?.value) !== 0) continue;
    const name = fieldText(values.get(1)?.value).trim() || id;
    const contextLength = fieldNumber(values.get(18)?.value) || DEFAULT_CONTEXT_WINDOW;
    models.set(id, {
      id,
      name,
      contextLength,
      maxOutputTokens: Math.min(contextLength, DEFAULT_MAX_TOKENS),
      input: fieldNumber(values.get(5)?.value) ? ["text", "image"] : ["text"],
      reasoning: !NO_REASONING_LABEL.test(name) && REASONING_LABEL.test(name),
    });
  }
  return [...models.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function decodeFields(buffer) {
  const fields = [];
  let offset = 0;
  while (offset < buffer.length) {
    const key = readVarint(buffer, offset);
    offset = key.offset;
    const number = Number(key.value >> 3n);
    const wire = Number(key.value & 7n);
    if (wire === 0) {
      const value = readVarint(buffer, offset);
      offset = value.offset;
      fields.push({ number, wire, value: value.value });
    } else if (wire === 2) {
      const length = readVarint(buffer, offset);
      offset = length.offset;
      const end = offset + Number(length.value);
      if (end > buffer.length) throw new Error("Invalid Devin model discovery protobuf length");
      fields.push({ number, wire, value: buffer.subarray(offset, end) });
      offset = end;
    } else if (wire === 1) {
      offset += 8;
    } else if (wire === 5) {
      offset += 4;
    } else {
      throw new Error(`Unsupported Devin model discovery wire type ${wire}`);
    }
  }
  return fields;
}

function readVarint(buffer, offset) {
  let value = 0n;
  let shift = 0n;
  while (offset < buffer.length) {
    const byte = buffer[offset++];
    value |= BigInt(byte & 127) << shift;
    if (!(byte & 128)) return { value, offset };
    shift += 7n;
    if (shift > 70n) throw new Error("Invalid Devin model discovery varint");
  }
  throw new Error("Truncated Devin model discovery varint");
}

function fieldText(value) {
  return Buffer.isBuffer(value) ? value.toString("utf8") : "";
}

function fieldNumber(value) {
  return typeof value === "bigint" ? Number(value) : 0;
}
