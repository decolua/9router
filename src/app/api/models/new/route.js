import { NextResponse } from "next/server";
import { buildModelsList } from "@/app/api/v1/models/route.js";
import {
  reconcileSeenModels,
  countUnseenModels,
} from "@/models";
import { AI_PROVIDERS } from "@/shared/constants/providers";

export const dynamic = "force-dynamic";

// In-memory result cache. Live model discovery hits many upstream providers,
// so we cache the computed result to avoid re-scanning on every modal open.
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes
let cache = { at: 0, data: null };

function isProviderFree(alias) {
  const provider = AI_PROVIDERS[alias];
  if (!provider) return false;
  if (provider.hasFree) return true;
  return provider.category === "free" || provider.category === "freeTier";
}

// Core discovery logic — extracts (alias, modelId) pairs from all providers,
// reconciles against the seen-models table, and returns the delta.
async function discoverNewModels() {
  const [llm, embedding, tts, image, stt] = await Promise.all([
    buildModelsList(["llm"], {}),
    buildModelsList(["embedding"], {}),
    buildModelsList(["tts"], {}),
    buildModelsList(["image"], {}),
    buildModelsList(["stt"], {}),
  ]);

  const observed = [];
  const seenPairs = new Set();
  for (const m of [...llm, ...embedding, ...tts, ...image, ...stt]) {
    const id = m?.id;
    if (typeof id !== "string" || !id.includes("/")) continue;
    const idx = id.indexOf("/");
    const alias = id.slice(0, idx);
    const modelId = id.slice(idx + 1);
    if (!alias || !modelId) continue;
    const key = `${alias}::${modelId}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    observed.push({ providerAlias: alias, modelId, isFree: isProviderFree(alias) });
  }

  if (observed.length === 0) {
    return { groups: [], total: 0, totalUnseen: 0, seeded: false };
  }

  const result = await reconcileSeenModels(observed);

  if (result.seeded) {
    const totalUnseen = await countUnseenModels();
    return { groups: [], total: 0, totalUnseen, seeded: true };
  }

  const merged = [
    ...result.new.map((m) => ({ ...m, isNew: true })),
    ...result.unseen.map((m) => ({ ...m, isNew: false })),
  ];
  merged.sort((a, b) => new Date(b.firstSeenAt) - new Date(a.firstSeenAt));

  const byProvider = {};
  for (const m of merged) {
    (byProvider[m.providerAlias] ||= []).push({
      modelId: m.modelId,
      isFree: m.isFree,
      firstSeenAt: m.firstSeenAt,
      isNew: m.isNew,
    });
  }

  const totalUnseen = await countUnseenModels();

  return {
    groups: Object.entries(byProvider).map(([alias, models]) => ({
      providerAlias: alias,
      providerName: AI_PROVIDERS[alias]?.name || alias,
      models,
    })),
    total: merged.length,
    totalUnseen,
    seeded: false,
  };
}

// GET /api/models/new
export async function GET() {
  try {
    const now = Date.now();
    if (cache.data && now - cache.at < CACHE_TTL_MS) {
      return NextResponse.json(cache.data);
    }

    const data = await discoverNewModels();
    cache = { at: Date.now(), data };
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error discovering new models:", error);
    return NextResponse.json(
      { error: "Failed to discover models", groups: [], total: 0, totalUnseen: 0, seeded: false },
      { status: 500 }
    );
  }
}
