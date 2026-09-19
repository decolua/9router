import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import {
  createProviderConnection,
  getCombos,
  getCustomModels,
  getModelAliases,
  getProviderConnectionById,
  getProviderConnections,
  getProviderNodes,
} from "@/models";
import REGISTRY from "open-sse/providers/registry/index.js";
import { DATA_DIR } from "@/lib/dataDir.js";

export const dynamic = "force-dynamic";

// Custom OpenAI-compatible nodes (local or third-party gateways) whose host
// exactly matches a native provider's models endpoint host are migration
// candidates. Matching is host-exact on purpose: a fuzzy match could point a
// user's key at the wrong service. Local Qwen nodes (localhost/LAN hosts)
// never match a public native host, so they stay custom by construction.
function nativeModelsHosts() {
  const hosts = new Map();
  for (const entry of REGISTRY) {
    const urls = [
      entry?.modelsFetcher?.url,
      entry?.transport?.validateUrl,
      entry?.transport?.baseUrl,
    ].filter((u) => typeof u === "string" && u.startsWith("http"));
    for (const raw of urls) {
      try {
        const host = new URL(raw).host.toLowerCase();
        if (!hosts.has(host)) hosts.set(host, entry.id);
      } catch {}
    }
  }
  return hosts;
}

function hostOf(raw) {
  try {
    return new URL(String(raw)).host.toLowerCase();
  } catch {
    return null;
  }
}

async function buildSuggestions() {
  const hosts = nativeModelsHosts();
  const [nodes, combos, aliases, customModels] = await Promise.all([
    getProviderNodes({ type: "openai-compatible" }),
    getCombos().catch(() => []),
    getModelAliases().catch(() => ({})),
    getCustomModels().catch(() => []),
  ]);
  const aliasEntries = Object.entries(aliases || {});
  const suggestions = [];
  for (const node of nodes || []) {
    const host = hostOf(node?.baseUrl);
    if (!host) continue;
    const nativeProvider = hosts.get(host);
    // Never suggest migrating a node to itself, and never suggest a custom
    // node id that already IS a native provider id.
    if (!nativeProvider || nativeProvider === node.id) continue;
    if (REGISTRY.some((e) => e.id === node.id)) continue;
    const prefix = node.prefix;
    const affectedCombos = (combos || [])
      .filter((combo) => (combo?.models || []).some((m) => typeof m === "string" && prefix && m.startsWith(`${prefix}/`)))
      .map((combo) => combo.name);
    const affectedAliases = aliasEntries
      .filter(([, full]) => typeof full === "string" && prefix && full.startsWith(`${prefix}/`))
      .map(([alias]) => alias);
    const affectedCustomModels = (customModels || [])
      .filter((m) => m?.providerAlias === prefix)
      .map((m) => m.id);
    suggestions.push({
      nodeId: node.id,
      nodeName: node.name,
      prefix,
      baseUrl: node.baseUrl,
      nativeProvider,
      affectedCombos,
      affectedAliases,
      affectedCustomModels,
    });
  }
  return suggestions;
}

export async function GET() {
  try {
    const suggestions = await buildSuggestions();
    return NextResponse.json({ suggestions });
  } catch (error) {
    console.log("Error building migration suggestions:", error);
    return NextResponse.json({ error: "Failed to build migration suggestions" }, { status: 500 });
  }
}

function writePreMigrationBackup(payload) {
  const dir = path.join(DATA_DIR, "migration-backups");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `custom-to-native-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  return file;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { connectionId, nativeProvider } = body || {};
    if (!connectionId || !nativeProvider) {
      return NextResponse.json({ error: "connectionId and nativeProvider are required" }, { status: 400 });
    }
    const native = REGISTRY.find((e) => e.id === nativeProvider);
    if (!native) return NextResponse.json({ error: "Unknown native provider" }, { status: 400 });

    const connection = await getProviderConnectionById(connectionId);
    if (!connection) return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    if (!connection.apiKey) {
      return NextResponse.json({ error: "This connection stores no API key to migrate" }, { status: 400 });
    }

    // Re-verify the host match server-side: the dashboard preview must not be
    // able to aim a key at an arbitrary provider id.
    const nodeHost = hostOf(connection.providerSpecificData?.baseUrl);
    const nativeHosts = new Set(
      [native?.modelsFetcher?.url, native?.transport?.validateUrl, native?.transport?.baseUrl]
        .filter((u) => typeof u === "string" && u.startsWith("http"))
        .map((u) => hostOf(u)),
    );
    if (!nodeHost || !nativeHosts.has(nodeHost)) {
      return NextResponse.json(
        { error: "Connection host does not match the native provider's endpoint host" },
        { status: 400 },
      );
    }

    const combos = await getCombos().catch(() => []);
    const aliases = await getModelAliases().catch(() => ({}));
    const prefix = connection.providerSpecificData?.prefix;
    const backupFile = writePreMigrationBackup({
      at: new Date().toISOString(),
      connection: { ...connection, apiKey: undefined, accessToken: undefined, refreshToken: undefined },
      nativeProvider,
      combos: (combos || []).filter((c) => (c?.models || []).some((m) => typeof m === "string" && prefix && m.startsWith(`${prefix}/`))),
      aliases: Object.fromEntries(Object.entries(aliases || {}).filter(([, full]) => typeof full === "string" && prefix && full.startsWith(`${prefix}/`))),
    });

    // Duplicate, never convert: the custom connection, its combos, aliases and
    // priorities stay untouched. The key is copied server-side and never
    // returns to the browser.
    const created = await createProviderConnection({
      provider: nativeProvider,
      authType: "apikey",
      name: `${connection.name || nativeProvider} (native)`,
      apiKey: connection.apiKey,
      priority: connection.priority,
      isActive: true,
      testStatus: "unknown",
    });

    // Automatic first sync of the new native connection: obeys
    // CONNECTION_MODEL_SYNC=off (T1.5 M4), same as POST /api/providers.
    try {
      const { syncConnectionCatalog } = await import("@/lib/modelSync/connectionCatalog.js");
      syncConnectionCatalog(created.id, { automatic: true }).catch(() => {});
    } catch {}

    return NextResponse.json({
      connection: { ...created, apiKey: undefined },
      backupFile,
      note: "Custom connection kept. Update combos/aliases to the native prefix manually.",
    }, { status: 201 });
  } catch (error) {
    console.log("Error migrating connection:", error);
    return NextResponse.json({ error: "Failed to migrate connection" }, { status: 500 });
  }
}
