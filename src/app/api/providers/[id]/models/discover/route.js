import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { getProviderConnectionById } from "@/lib/localDb";
import { isOpenAICompatibleProvider } from "@/shared/constants/providers";
import { resolveKiroModels } from "open-sse/services/kiroModels.js";
import { resolveQoderModels } from "open-sse/services/qoderModels.js";
import { resolveGrokCliModels } from "open-sse/services/grokCliModels.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { updateProviderCredentials } from "@/sse/services/tokenRefresh";
import { PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";
import * as snapshotsRepo from "@/lib/db/repos/snapshotsRepo";

export const dynamic = "force-dynamic";

const MAX_MODELS = 200;
const RESOLVER_TIMEOUT_MS = 10000;

const parseOpenAIStyleModels = (data) => {
  if (Array.isArray(data)) return data;
  return data?.data || data?.models || data?.results || [];
};

function inferKindFromModelId(modelId) {
  if (!modelId) return "unknown";
  const lower = modelId.toLowerCase();
  if (lower.includes("embed")) return "embedding";
  if (lower.includes("image") || lower.includes("dall-e")) return "image";
  if (lower.includes("audio") || lower.includes("whisper") || lower.includes("tts")) return "audio";
  return "llm";
}

function getProviderAlias(provider) {
  return PROVIDER_ID_TO_ALIAS[provider] || provider;
}

/**
 * Compute a stable SHA-256 of a raw model payload.
 * Keys are sorted so the hash is deterministic regardless of object property order.
 */
function stableHash(rawModel) {
  if (rawModel === null || rawModel === undefined) return null;
  try {
    const sorted = sortedStringify(rawModel);
    return crypto.createHash("sha256").update(sorted).digest("hex");
  } catch {
    return null;
  }
}

function sortedStringify(value) {
  if (Array.isArray(value)) {
    return "[" + value.map(sortedStringify).join(",") + "]";
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + sortedStringify(value[k])).join(",") + "}";
  }
  return JSON.stringify(value);
}

/**
 * Extract boolean capability flags from a raw upstream model object.
 * Looks at common property names used by various providers.
 */
function extractCapabilityFlags(rawModel) {
  const check = (fields) => fields.some((f) => rawModel[f] === true || rawModel[f] === 1 || rawModel[f] === "true");

  return {
    supportsReasoning: check(["reasoning", "supports_reasoning", "supportsReasoning", "thinking", "supports_thinking"]),
    supportsTools: check(["tools", "function_calling", "supports_tools", "supportsTools", "supports_function_calling", "supportsTools"]),
    supportsSearch: check(["search", "web_search", "supports_search", "supportsSearch", "live_search"]),
    supportsVision: check(["vision", "supports_vision", "supportsVision", "image_input", "multimodal"]),
  };
}

function normalizeToSnapshot({ rawModel, connectionId, providerAlias, fetchedAt, discoveryBatchId }) {
  const rawModelId = rawModel.id || rawModel.model || rawModel.slug || rawModel.name || String(rawModel);
  const displayName = rawModel.display_name || rawModel.displayName || rawModel.name || rawModelId;
  const contextWindow =
    rawModel.context_length ||
    rawModel.contextWindow ||
    rawModel.context_window ||
    rawModel.maxContextWindow ||
    rawModel.contextLength ||
    null;
  const maxOutput =
    rawModel.max_output_tokens ||
    rawModel.maxOutputTokens ||
    rawModel.max_tokens ||
    rawModel.maxOutputTokens ||
    null;
  const inputModalities = rawModel.inputModalities || rawModel.input_modalities || null;
  const outputModalities = rawModel.outputModalities || rawModel.output_modalities || null;

  const capabilityFlags = extractCapabilityFlags(rawModel);
  const rawPayloadHash = stableHash(rawModel);

  return {
    id: uuidv4(),
    discoveryBatchId,
    providerAlias,
    connectionId,
    rawModelId,
    canonicalId: `${providerAlias}/${rawModelId}`,
    displayName,
    modelKind: inferKindFromModelId(rawModelId),
    source: "upstream_api",
    confidence: "authoritative",
    contextWindow: contextWindow != null ? Number(contextWindow) : null,
    maxOutput: maxOutput != null ? Number(maxOutput) : null,
    inputModalities: inputModalities || null,
    outputModalities: outputModalities || null,
    supportsReasoning: capabilityFlags.supportsReasoning,
    supportsTools: capabilityFlags.supportsTools,
    supportsSearch: capabilityFlags.supportsSearch,
    supportsVision: capabilityFlags.supportsVision,
    rawPayload: rawModel,
    rawPayloadHash,
    fetchedAt,
    observedAt: fetchedAt,
    expiresAt: null,
    status: "active",
  };
}

async function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Resolver timed out")), ms)),
  ]);
}

async function resolveModelsForConnection(connection) {
  const { provider, accessToken, refreshToken, providerSpecificData } = connection;
  const warnings = [];

  if (provider === "grok-cli") {
    const proxy = await resolveConnectionProxyConfig(providerSpecificData || {});
    const result = await withTimeout(
      resolveGrokCliModels(
        { ...connection, connectionId: connection.id },
        {
          log: console,
          proxyOptions: {
            connectionProxyEnabled: proxy.connectionProxyEnabled === true,
            connectionProxyUrl: proxy.connectionProxyUrl || "",
            connectionNoProxy: proxy.connectionNoProxy || "",
            vercelRelayUrl: proxy.vercelRelayUrl || "",
            strictProxy: proxy.strictProxy === true,
          },
          onCredentialsRefreshed: async (refreshed) => {
            await updateProviderCredentials(connection.id, {
              ...refreshed,
              existingProviderSpecificData: providerSpecificData || {},
            });
          },
        }
      ),
      RESOLVER_TIMEOUT_MS
    );
    if (result?.warning) warnings.push(result.warning);
    return { rawModels: result?.models || [], warnings };
  }

  if (provider === "kiro") {
    const result = await withTimeout(
      resolveKiroModels(
        { accessToken, refreshToken, providerSpecificData: providerSpecificData || {} },
        {
          log: console,
          onCredentialsRefreshed: async (refreshed) => {
            if (refreshed?.accessToken) {
              await updateProviderCredentials(connection.id, {
                accessToken: refreshed.accessToken,
                refreshToken: refreshed.refreshToken || refreshToken,
                expiresIn: refreshed.expiresIn,
              });
            }
          },
        }
      ),
      RESOLVER_TIMEOUT_MS
    );
    if (result?.warning) warnings.push(result.warning);
    return { rawModels: result?.models || [], warnings };
  }

  if (provider === "qoder") {
    const result = await withTimeout(
      resolveQoderModels(
        {
          accessToken,
          apiKey: connection.apiKey,
          refreshToken,
          email: connection.email,
          displayName: connection.displayName,
          providerSpecificData: providerSpecificData || {},
        },
        { forceRefresh: true }
      ),
      RESOLVER_TIMEOUT_MS
    );
    if (result?.warning) warnings.push(result.warning);
    return { rawModels: result?.models || [], warnings };
  }

  if (isOpenAICompatibleProvider(provider)) {
    const baseUrl = providerSpecificData?.baseUrl;
    if (!baseUrl) return { rawModels: [], warnings: ["No baseUrl configured for openai-compatible provider"] };
    const url = `${baseUrl.replace(/\/$/, "")}/models`;
    const token = accessToken || connection.apiKey;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RESOLVER_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) {
        return { rawModels: [], warnings: [`Failed to fetch models: ${response.status}`] };
      }
      const data = await response.json();
      return { rawModels: parseOpenAIStyleModels(data), warnings };
    } catch (err) {
      clearTimeout(timer);
      return { rawModels: [], warnings: [`Fetch error: ${err.message}`] };
    }
  }

  return { rawModels: [], warnings: [`Provider ${provider} is not supported for discover`] };
}

/**
 * GET /api/providers/[id]/models/discover
 *
 * Flow:
 * 1. Resolve raw models from upstream.
 * 2. Assign a shared discoveryBatchId to all models in this fetch.
 * 3. Normalize each model → snapshot (rawPayload + SHA-256 hash + capability flags).
 * 4. Diff new snapshots against the PREVIOUS batch (not the current one).
 * 5. Save the new batch transactionally.
 * 6. Return diff + snapshotId (any row from the batch) for use in the import flow.
 */
export async function GET(request, { params }) {
  const overallController = new AbortController();
  const overallTimer = setTimeout(() => overallController.abort(), 30000);

  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);

    if (!connection) {
      clearTimeout(overallTimer);
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const providerAlias = getProviderAlias(connection.provider);
    const fetchedAt = new Date().toISOString();
    // All models from this fetch share one batch ID.
    const discoveryBatchId = uuidv4();

    let rawModels, warnings;
    try {
      ({ rawModels, warnings } = await resolveModelsForConnection(connection));
    } catch (err) {
      clearTimeout(overallTimer);
      return NextResponse.json({ error: `Resolver failed: ${err.message}` }, { status: 500 });
    }

    const truncated = rawModels.length > MAX_MODELS;
    const modelsToProcess = truncated ? rawModels.slice(0, MAX_MODELS) : rawModels;
    if (truncated) {
      warnings = warnings || [];
      warnings.push(`Result truncated to ${MAX_MODELS} models (upstream returned ${rawModels.length})`);
    }

    const snapshots = modelsToProcess.map((rawModel) =>
      normalizeToSnapshot({ rawModel, connectionId: id, providerAlias, fetchedAt, discoveryBatchId })
    );

    // Step 4: diff BEFORE saving so we compare against the true previous batch.
    const diff = await snapshotsRepo.diffAgainstPreviousBatch(id, snapshots, discoveryBatchId);

    // Step 5: save batch transactionally.
    await snapshotsRepo.saveSnapshotBatch(snapshots);

    const diffMap = new Map();
    for (const s of diff.new) diffMap.set(s.canonicalId, "new");
    for (const s of diff.removed) diffMap.set(s.canonicalId, "removed");
    for (const entry of diff.changed) diffMap.set(entry.canonicalId, "changed");
    for (const s of diff.unchanged) diffMap.set(s.canonicalId, "unchanged");

    clearTimeout(overallTimer);
    return NextResponse.json({
      // Any snapshot id from this batch; the import route uses discoveryBatchId
      // from the snapshot record, so this single id is sufficient to anchor the batch.
      snapshotId: snapshots[0]?.id ?? null,
      discoveryBatchId,
      connectionId: id,
      provider: connection.provider,
      total: snapshots.length,
      new: diff.new.length,
      removed: diff.removed.length,
      changed: diff.changed.length,
      unchanged: diff.unchanged.length,
      models: snapshots.map((s) => ({
        id: s.id,
        rawModelId: s.rawModelId,
        canonicalId: s.canonicalId,
        displayName: s.displayName,
        modelKind: s.modelKind,
        contextWindow: s.contextWindow,
        maxOutput: s.maxOutput,
        inputModalities: s.inputModalities,
        outputModalities: s.outputModalities,
        supportsReasoning: s.supportsReasoning,
        supportsTools: s.supportsTools,
        supportsSearch: s.supportsSearch,
        supportsVision: s.supportsVision,
        source: s.source,
        confidence: s.confidence,
        rawPayloadHash: s.rawPayloadHash,
        status: s.status,
        fetchedAt: s.fetchedAt,
        observedAt: s.observedAt,
        diff: diffMap.get(s.canonicalId) ?? "new",
      })),
      warnings: warnings || [],
    });
  } catch (error) {
    clearTimeout(overallTimer);
    console.warn("Error in discover endpoint:", error);
    return NextResponse.json({ error: "Failed to discover models" }, { status: 500 });
  }
}
