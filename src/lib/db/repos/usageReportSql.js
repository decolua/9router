import { decryptKey } from "../helpers/keyEncryption.js";
import { fingerprint } from "../helpers/usageFingerprint.js";
import { ERROR_CATEGORY } from "open-sse/config/inferenceErrors.js";

import { publicText, publicKeyOwnership } from "../../../shared/utils/keyOwnership.js";

export function providerLabels(db) {
  const names = new Map(db.all("SELECT id,name FROM providerNodes WHERE type IN ('openai-compatible','anthropic-compatible')")
    .map(row => [row.id, publicText(row.name?.trim())]));
  return id => names.get(id) || publicText(id);
}

export function keyDirectory(db) {
  const keys = new Map();
  for (const row of db.all("SELECT id,name,description,owner,project,key_version,key_ciphertext FROM apiKeys")) {
    const raw = decryptKey(db, row);
    if (raw) keys.set(fingerprint(raw), { id: publicText(row.id), name: publicText(row.name), ...publicKeyOwnership(row) });
  }
  for (const row of db.all(`SELECT h.fingerprint,k.id,k.name,k.description,k.owner,k.project FROM retiredKeyFingerprints h
      JOIN apiKeys k ON k.id=h.keyId`)) {
    keys.set(row.fingerprint, { id: publicText(row.id), name: publicText(row.name), ...publicKeyOwnership(row) });
  }
  return keys;
}

export const failed = "CASE WHEN coalesce(status,'ok') IN ('ok','success') THEN 0 ELSE 1 END";
export const tokens = "(coalesce(promptTokens,0) + coalesce(completionTokens,0))";
export const category = `CASE WHEN json_extract(meta,'$.errorCategory') IN
  (${Object.values(ERROR_CATEGORY).map(v => "'" + v + "'").join(",")}) THEN json_extract(meta,'$.errorCategory') END`;
export const numeric = (col, path) => `CASE WHEN json_type(${col}, '$.${path}') IN ('integer','real')
  AND json_extract(${col}, '$.${path}') >= 0 THEN json_extract(${col}, '$.${path}') END`;
export const latency = numeric("meta", "latencyMs");

function rangeFilter({ from, to }) {
  return from === null ? { where: "1=1", params: [] } :
    { where: "timestamp >= ? AND timestamp < ?", params: [from, to] };
}

// Use current ownership for every fingerprint, including retired key versions.
export function reportFilter(range, directory) {
  const filter = rangeFilter(range);
  if (range.project != null) {
    const refs = [...directory].filter(([, key]) => key.project === range.project).map(([ref]) => ref);
    filter.where += " AND apiKey IN (SELECT value FROM json_each(?))";
    filter.params.push(JSON.stringify(refs));
  }
  return filter;
}
