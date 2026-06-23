import { createHash } from "node:crypto";

const API_KEY_USAGE_ID_RE = /^sha256:[0-9a-f]{16}$/i;

export function isApiKeyUsageId(value: string): boolean {
  return API_KEY_USAGE_ID_RE.test(value);
}

export function createApiKeyUsageId(apiKey: string): string {
  return `sha256:${createHash("sha256").update(apiKey).digest("hex").slice(0, 16)}`;
}

export function normalizeApiKeyUsageId(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") return null;
  if (isApiKeyUsageId(value)) return value.toLowerCase();
  return createApiKeyUsageId(value);
}

// Raw daily-summary row from legacy usage.json. Keys and value shapes are
// heterogeneous legacy data — we accept unknown at this parse boundary.
interface LegacyDayEntry {
  rawModel?: string;
  provider?: string;
  apiKey?: string | null;
  requests?: number;
  promptTokens?: number;
  completionTokens?: number;
  cost?: number;
  [key: string]: unknown;
}

interface LegacyDay {
  byApiKey?: Record<string, unknown>;
  [key: string]: unknown;
}

interface NormalizedDayEntry extends LegacyDayEntry {
  rawModel: string;
  provider: string;
  apiKey: string | null;
}

export function normalizeUsageDailySummary(day: unknown): unknown {
  if (!day || typeof day !== "object" || Array.isArray(day)) return day;
  const d = day as LegacyDay;
  if (!d.byApiKey || typeof d.byApiKey !== "object") return day;

  const normalized: Record<string, NormalizedDayEntry> = {};
  for (const [legacyKey, value] of Object.entries(d.byApiKey)) {
    const entry: LegacyDayEntry = value && typeof value === "object" ? { ...(value as LegacyDayEntry) } : {};
    const parts = String(legacyKey).split("|");
    const legacyApiKey = parts[0] && parts[0] !== "local-no-key" ? parts[0] : null;
    const rawModel = entry.rawModel ?? parts[1] ?? "";
    const provider = entry.provider ?? parts[2] ?? "unknown";
    const apiKeyId = normalizeApiKeyUsageId(entry.apiKey as string | undefined) ?? normalizeApiKeyUsageId(legacyApiKey);
    const apiKeyKey = apiKeyId ?? "local-no-key";
    const normalizedKey = `${apiKeyKey}|${rawModel}|${provider || "unknown"}`;

    const next: NormalizedDayEntry = { ...entry, rawModel, provider, apiKey: apiKeyId };
    if (!normalized[normalizedKey]) {
      normalized[normalizedKey] = next;
      continue;
    }
    const existing = normalized[normalizedKey]!;
    existing.requests = (existing.requests ?? 0) + (next.requests ?? 0);
    existing.promptTokens = (existing.promptTokens ?? 0) + (next.promptTokens ?? 0);
    existing.completionTokens = (existing.completionTokens ?? 0) + (next.completionTokens ?? 0);
    existing.cost = (existing.cost ?? 0) + (next.cost ?? 0);
  }

  return { ...d, byApiKey: normalized };
}
