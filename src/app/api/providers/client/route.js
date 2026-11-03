import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/localDb";
import { backfillCodexEmails } from "@/lib/oauth/providers";
import { getRequestCountsByConnection } from "@/lib/db/index.js";
import { sortConnections } from "./sortConnections.js";
import { USAGE_APIKEY_PROVIDERS, USAGE_SUPPORTED_PROVIDERS } from "@/shared/constants/providers";

const SAFE_FIELDS = [
  "id", "provider", "authType", "name", "email", "displayName",
  "priority", "globalPriority", "isActive", "defaultModel",
  "testStatus", "lastError", "lastErrorAt", "errorCode",
  "expiresAt", "lastUsedAt", "consecutiveUseCount",
  "createdAt", "updatedAt",
];

const SAFE_PSD_FIELDS = [
  "baseUrl", "azureEndpoint", "deployment", "apiVersion", "accountId",
  "region", "projectId", "resourceUrl", "proxyPoolId",
  "connectionProxyEnabled", "connectionProxyUrl", "connectionNoProxy",
  "githubLogin", "githubName", "githubEmail", "githubUserId",
  "username", "firstName", "lastName", "authMethod", "authKind",
  "profileArn",
];

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 500;

function maskName(name) {
  if (typeof name !== "string" || name.length <= 16) return name;
  if (/[a-zA-Z0-9_-]{32,}/.test(name)) return `${name.slice(0, 8)}***`;
  return name;
}

function sanitize(c) {
  const safe = {};
  for (const f of SAFE_FIELDS) if (c[f] !== undefined) safe[f] = c[f];
  if (safe.name) safe.name = maskName(safe.name);
  if (c.providerSpecificData) {
    const psd = {};
    for (const f of SAFE_PSD_FIELDS) {
      if (c.providerSpecificData[f] !== undefined) psd[f] = c.providerSpecificData[f];
    }
    safe.providerSpecificData = psd;
  }
  return safe;
}

function isUsageEligible(connection) {
  return USAGE_SUPPORTED_PROVIDERS.includes(connection.provider) && (
    connection.authType === "oauth" || USAGE_APIKEY_PROVIDERS.includes(connection.provider)
  );
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const USAGE_WINDOW_MS = 7 * 24 * 3600e3;

export async function GET(request) {
  try {
    await backfillCodexEmails();

    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider") || "all";
    const accountStatus = searchParams.get("accountStatus") || "all";
    const sort = searchParams.get("sort") || "priority";
    const page = parsePositiveInt(searchParams.get("page"), 1);
    const pageSize = Math.min(parsePositiveInt(searchParams.get("pageSize"), DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);

    const allConnections = await getProviderConnections();
    const eligibleConnections = allConnections.filter(isUsageEligible);
    const providerOptions = Array.from(new Set(eligibleConnections.map((conn) => conn.provider))).sort();

    const providerFilteredConnections = eligibleConnections.filter((conn) => (
      provider === "all" || conn.provider === provider
    ));

    const accountFilteredConnections = providerFilteredConnections.filter((conn) => {
      if (accountStatus === "active") return conn.isActive ?? true;
      if (accountStatus === "inactive") return !(conn.isActive ?? true);
      return true;
    });

    const usageCounts = sort === "usage"
      ? await getRequestCountsByConnection(new Date(Date.now() - USAGE_WINDOW_MS).toISOString()).catch(() => ({}))
      : {};
    const sortedConnections = sortConnections(accountFilteredConnections, sort, usageCounts);
    const total = sortedConnections.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const currentPage = Math.min(page, totalPages);
    const offset = (currentPage - 1) * pageSize;
    const pageConnections = sortedConnections.slice(offset, offset + pageSize).map(sanitize);

    return NextResponse.json({
      connections: pageConnections,
      providerOptions,
      pagination: {
        page: currentPage,
        pageSize,
        total,
        totalPages,
      },
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
