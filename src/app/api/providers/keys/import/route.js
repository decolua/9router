import { NextResponse } from "next/server";
import {
  createProviderConnection,
  getProviderConnections,
  getProviderNodeById,
  getProxyPoolById,
} from "@/models";
import { APIKEY_PROVIDERS } from "@/shared/constants/config";
import {
  AI_PROVIDERS,
  FREE_TIER_PROVIDERS,
  WEB_COOKIE_PROVIDERS,
  isOpenAICompatibleProvider,
  isAnthropicCompatibleProvider,
  isCustomEmbeddingProvider,
} from "@/shared/constants/providers";
import { normalizeProviderId, normalizeProviderSpecificData } from "@/lib/providerNormalization";
import { ensureKeyNames, parseImportContent } from "@/lib/providerKeysIo";

export const dynamic = "force-dynamic";

function isValidApiKeyProvider(provider) {
  const supportsApiKeyMode = !!AI_PROVIDERS[provider]?.authModes?.includes("apikey");
  return !!(
    APIKEY_PROVIDERS[provider] ||
    FREE_TIER_PROVIDERS[provider] ||
    supportsApiKeyMode ||
    WEB_COOKIE_PROVIDERS[provider] ||
    isOpenAICompatibleProvider(provider) ||
    isAnthropicCompatibleProvider(provider) ||
    isCustomEmbeddingProvider(provider)
  );
}

async function buildProviderSpecificData(provider, entry) {
  let providerSpecificData = normalizeProviderSpecificData(
    provider,
    entry,
    entry.providerSpecificData || null
  );

  if (isOpenAICompatibleProvider(provider)) {
    const node = await getProviderNodeById(provider);
    if (!node) throw new Error("OpenAI Compatible node not found");
    providerSpecificData = {
      prefix: node.prefix,
      apiType: node.apiType,
      baseUrl: node.baseUrl,
      nodeName: node.name,
      ...(providerSpecificData || {}),
    };
  } else if (isAnthropicCompatibleProvider(provider)) {
    const node = await getProviderNodeById(provider);
    if (!node) throw new Error("Anthropic Compatible node not found");
    providerSpecificData = {
      prefix: node.prefix,
      baseUrl: node.baseUrl,
      nodeName: node.name,
      ...(providerSpecificData || {}),
    };
  } else if (isCustomEmbeddingProvider(provider)) {
    const node = await getProviderNodeById(provider);
    if (!node) throw new Error("Custom Embedding node not found");
    providerSpecificData = {
      prefix: node.prefix,
      baseUrl: node.baseUrl,
      nodeName: node.name,
      ...(providerSpecificData || {}),
    };
  }

  // Optional proxy pool from import (must already exist)
  if (entry.proxyPoolId) {
    const pool = await getProxyPoolById(String(entry.proxyPoolId).trim());
    if (pool) {
      providerSpecificData = {
        ...(providerSpecificData || {}),
        proxyPoolId: pool.id,
      };
    }
  }

  return providerSpecificData;
}

/**
 * POST /api/providers/keys/import
 *
 * Body:
 * {
 *   provider: string,
 *   format?: "json" | "txt" | "auto",
 *   content: string | object,   // raw text, JSON string, or parsed object
 *   skipDuplicates?: boolean    // skip when same apiKey already exists (default true)
 * }
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const provider = normalizeProviderId(body.provider);
    const format = body.format || "auto";
    const skipDuplicates = body.skipDuplicates !== false;
    const content = body.content ?? body.keys ?? body.text ?? body.data;

    if (!provider || !isValidApiKeyProvider(provider)) {
      return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
    }
    if (content === undefined || content === null || content === "") {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }

    let parsed;
    try {
      parsed = parseImportContent(content, format, { provider });
    } catch (err) {
      return NextResponse.json({ error: err.message || "Failed to parse content" }, { status: 400 });
    }

    if (parsed.providerHint && normalizeProviderId(parsed.providerHint) !== provider) {
      return NextResponse.json(
        {
          error: `File is for provider "${parsed.providerHint}", but import target is "${provider}"`,
        },
        { status: 400 }
      );
    }

    let keys = ensureKeyNames(parsed.keys, "Key");
    if (keys.length === 0) {
      return NextResponse.json({ error: "No keys found in input" }, { status: 400 });
    }

    const isWebCookieProvider = !!WEB_COOKIE_PROVIDERS[provider];
    const existing = await getProviderConnections({ provider });
    const existingKeys = new Set(
      existing
        .filter((c) => c.authType === "apikey" || c.authType === "cookie")
        .map((c) => c.apiKey)
        .filter(Boolean)
    );

    const results = [];
    let success = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < keys.length; i++) {
      const entry = keys[i];
      try {
        if (!entry.apiKey && provider !== "ollama-local") {
          results.push({ index: i, ok: false, error: "API key is required" });
          failed += 1;
          continue;
        }

        if (skipDuplicates && entry.apiKey && existingKeys.has(entry.apiKey)) {
          results.push({ index: i, ok: true, skipped: true, name: entry.name, reason: "duplicate apiKey" });
          skipped += 1;
          continue;
        }

        const providerSpecificData = await buildProviderSpecificData(provider, entry);
        const authType = isWebCookieProvider
          ? "cookie"
          : entry.authType === "cookie"
            ? "cookie"
            : "apikey";

        const conn = await createProviderConnection({
          provider,
          authType,
          name: entry.name,
          apiKey: entry.apiKey || "",
          priority: entry.priority || 1,
          globalPriority: entry.globalPriority ?? null,
          defaultModel: entry.defaultModel || null,
          providerSpecificData: providerSpecificData || undefined,
          isActive: entry.isActive !== false,
          testStatus: "unknown",
        });

        if (entry.apiKey) existingKeys.add(entry.apiKey);
        results.push({ index: i, ok: true, id: conn.id, name: conn.name });
        success += 1;
      } catch (err) {
        results.push({ index: i, ok: false, error: err.message || "Failed to import key" });
        failed += 1;
      }
    }

    return NextResponse.json({
      provider,
      format: parsed.format,
      total: keys.length,
      success,
      skipped,
      failed,
      results,
    });
  } catch (error) {
    console.log("Error importing provider keys:", error);
    return NextResponse.json({ error: "Failed to import provider keys" }, { status: 500 });
  }
}
