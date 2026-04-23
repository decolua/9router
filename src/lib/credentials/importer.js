/**
 * Credential import orchestration
 */

import {
  createProviderConnection,
  getProviderConnections,
  updateProviderConnection,
} from "@/lib/localDb";
import { ConnectionMatcher, validateNoDuplicateImports } from "./matcher";
import { normalizeInputRecord, extractInputRecords } from "./normalizer";
import { sanitizeCredentialRecord } from "./validator";

export async function importCredentials(payload) {
  const inputRecords = extractInputRecords(payload);
  if (!inputRecords) {
    throw new Error("Payload must contain credentials array or equivalent entries");
  }

  // Normalize all records first
  const normalizedRecords = [];
  const skipReasons = [];

  for (const item of inputRecords) {
    const normalized = normalizeInputRecord(item);
    if (!normalized) {
      skipReasons.push({
        code: "INVALID_RECORD",
        message: "Credential record must be an object",
      });
      continue;
    }

    try {
      const sanitized = sanitizeCredentialRecord(normalized);
      normalizedRecords.push({
        sourceId: typeof normalized.id === "string" ? normalized.id : null,
        data: sanitized,
      });
    } catch (error) {
      skipReasons.push({
        code: error?.code || "INVALID_RECORD",
        message: error?.message || "Credential record is invalid",
      });
    }
  }

  // Validate no duplicate imports
  const duplicates = validateNoDuplicateImports(
    normalizedRecords.map((r) => r.data),
  );
  if (duplicates.length > 0) {
    const details = duplicates
      .map((d) => `Record ${d.index} duplicates record ${d.firstIndex} (${d.key})`)
      .join("; ");
    throw new Error(`Duplicate import records detected: ${details}`);
  }

  // Fetch existing connections and build matcher
  const existing = await getProviderConnections();
  const matcher = new ConnectionMatcher(existing);

  let created = 0;
  let updated = 0;

  for (const { sourceId, data } of normalizedRecords) {
    const existingConnection = matcher.findMatch(data, sourceId);

    if (existingConnection) {
      await updateProviderConnection(existingConnection.id, data);
      matcher.updateConnection(existingConnection.id, data);
      matcher.markProcessed(existingConnection.id);
      updated += 1;
    } else {
      if (data.authType === "apikey" && !data.name) {
        skipReasons.push({
          code: "INVALID_RECORD",
          message: "API key credential record is missing name",
        });
        continue;
      }

      const createdConnection = await createProviderConnection(data);
      matcher.addConnection(createdConnection);
      matcher.markProcessed(createdConnection.id);
      created += 1;
    }
  }

  return {
    created,
    updated,
    skipped: skipReasons.length,
    imported: created + updated,
    skipReasons,
  };
}
