import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { JsonValue } from "open-sse/types/executor.js";
import type { ProviderConnection } from "@/lib/db/repos/connectionsRepo";
import { getProviderConnections } from "@/lib/localDb";
import { backfillCodexEmails } from "@/lib/oauth/providers";
import { USAGE_APIKEY_PROVIDERS, USAGE_SUPPORTED_PROVIDERS } from "@/shared/constants/providers";

type JsonObject = { [key: string]: JsonValue };

const SAFE_FIELDS = [
  "id", "provider", "authType", "name", "email", "displayName",
  "priority", "globalPriority", "isActive", "defaultModel",
  "testStatus", "lastError", "lastErrorAt", "errorCode",
  "expiresAt", "lastUsedAt", "consecutiveUseCount",
  "createdAt", "updatedAt",
  // Persisted last-known quota (written by the usage route) so the UI can
  // render immediately without waiting for a per-connection live refetch.
  "quotaInfos", "quotaPlan", "quotaMessage", "quotaUpdatedAt",
] as const;

const SAFE_PSD_FIELDS = [
  "baseUrl", "azureEndpoint", "deployment", "apiVersion", "accountId",
  "region", "projectId", "resourceUrl", "proxyPoolId",
  "connectionProxyEnabled", "connectionProxyUrl", "connectionNoProxy",
  "githubLogin", "githubName", "githubEmail", "githubUserId",
  "username", "firstName", "lastName", "authMethod", "authKind",
  "profileArn",
] as const;

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 500;

function maskName(name: string) {
  if (name.length <= 16) return name;
  if (/[a-zA-Z0-9_-]{32,}/.test(name)) return `${name.slice(0, 8)}***`;
  return name;
}

function sanitize(c: ProviderConnection) {
  const safe: JsonObject = {};
  for (const f of SAFE_FIELDS) if (c[f] !== undefined) safe[f] = c[f] as JsonValue;
  const name = c.name;
  if (typeof name === "string") safe["name"] = maskName(name);
  const psd = c["providerSpecificData"];
  if (psd !== null && typeof psd === "object") {
    const psdObj = psd as JsonObject;
    const safePsd: JsonObject = {};
    for (const f of SAFE_PSD_FIELDS) if (psdObj[f] !== undefined) safePsd[f] = psdObj[f] as JsonValue;
    safe["providerSpecificData"] = safePsd;
  }
  return safe;
}

function isUsageEligible(connection: ProviderConnection) {
  return (
    USAGE_SUPPORTED_PROVIDERS.includes(connection.provider) &&
    (connection.authType === "oauth" || USAGE_APIKEY_PROVIDERS.includes(connection.provider))
  );
}

function parsePositiveInt(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sortConnections(connections: ProviderConnection[], sort: string) {
  const list = [...connections];

  if (sort === "provider") {
    return list.sort((a, b) => {
      const orderA = USAGE_SUPPORTED_PROVIDERS.indexOf(a.provider);
      const orderB = USAGE_SUPPORTED_PROVIDERS.indexOf(b.provider);
      if (orderA !== orderB) return orderA - orderB;
      return a.provider.localeCompare(b.provider);
    });
  }

  return list.sort((a, b) => {
    const priorityA = a.priority ?? Number.MAX_SAFE_INTEGER;
    const priorityB = b.priority ?? Number.MAX_SAFE_INTEGER;
    if (priorityA !== priorityB) return priorityA - priorityB;
    return (a.provider || "").localeCompare(b.provider || "");
  });
}

export async function GET(request: NextRequest, context: { params: Promise<{}> }) {
  await context.params;
  try {
    await backfillCodexEmails();

    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider") ?? "all";
    const accountStatus = searchParams.get("accountStatus") ?? "all";
    const sort = searchParams.get("sort") ?? "priority";
    const page = parsePositiveInt(searchParams.get("page"), 1);
    const pageSize = Math.min(
      parsePositiveInt(searchParams.get("pageSize"), DEFAULT_PAGE_SIZE),
      MAX_PAGE_SIZE,
    );

    const allConnections = await getProviderConnections();
    const eligibleConnections = allConnections.filter(isUsageEligible);
    const providerOptions = Array.from(new Set(eligibleConnections.map((c) => c.provider))).sort();

    const providerFilteredConnections = eligibleConnections.filter(
      (conn) => provider === "all" || conn.provider === provider,
    );

    const accountFilteredConnections = providerFilteredConnections.filter((conn) => {
      if (accountStatus === "active") return conn.isActive;
      if (accountStatus === "inactive") return !conn.isActive;
      return true;
    });

    const sortedConnections = sortConnections(accountFilteredConnections, sort);
    const total = sortedConnections.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const currentPage = Math.min(page, totalPages);
    const offset = (currentPage - 1) * pageSize;
    const pageConnections = sortedConnections.slice(offset, offset + pageSize).map(sanitize);

    return NextResponse.json({
      connections: pageConnections,
      providerOptions,
      pagination: { page: currentPage, pageSize, total, totalPages },
      totals: {
        eligibleConnections: eligibleConnections.length,
        providerFilteredConnections: providerFilteredConnections.length,
      },
    });
  } catch (error) {
    console.log("Error fetching providers for client:", error);
    return NextResponse.json({ error: "Failed to fetch providers" }, { status: 500 });
  }
}
