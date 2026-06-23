import type { NextRequest } from "next/server";
import type { JsonValue } from "open-sse/types/executor.js";
import { NextResponse } from "next/server";
import { getApiKeys, createApiKey, getMonthlyUsageForKey } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { requireKey, requireAdmin, publicKeyView } from "../_auth.js";

export const dynamic = "force-dynamic";

// GET /api/v1/admin/keys (admin) — list all keys with usage this month.
// Raw `key` field is stripped.
export async function GET(request: NextRequest) {
  try {
    const { record } = await requireKey(request);
    requireAdmin(record);
    const keys = await getApiKeys();
    const enriched = [];
    for (const k of keys) {
      const v = publicKeyView(k);
      try {
        const u = await getMonthlyUsageForKey(k.key);
        v.usageThisMonth = {
          tokens: u.tokens,
          cost: u.cost,
          requests: u.requests,
          monthStart: u.monthStart,
        };
      } catch {
        v.usageThisMonth = null;
      }
      enriched.push(v);
    }
    return NextResponse.json({ keys: enriched });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}

// POST /api/v1/admin/keys (admin) — create a key. Raw key returned ONCE (201).
export async function POST(request: NextRequest) {
  try {
    const { record } = await requireKey(request);
    requireAdmin(record);
    const body = (await request.json()) as Record<string, JsonValue>;
    if (!body["name"]) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const opts: Record<string, JsonValue> = {};
    if (body["role"] !== undefined) opts["role"] = body["role"];
    if (Array.isArray(body["allowedModels"]))
      opts["allowedModels"] = body["allowedModels"];
    if (Array.isArray(body["allowedProviders"]))
      opts["allowedProviders"] = body["allowedProviders"];
    if (body["monthlyTokenLimit"] !== undefined)
      opts["monthlyTokenLimit"] = body["monthlyTokenLimit"];
    if (body["monthlyBudgetUsd"] !== undefined)
      opts["monthlyBudgetUsd"] = body["monthlyBudgetUsd"];
    const machineId = await getConsistentMachineId();
    const apiKey = await createApiKey(String(body["name"]), machineId, opts);
    return NextResponse.json(publicKeyView(apiKey), { status: 201 });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
