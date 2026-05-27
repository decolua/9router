import { NextResponse } from "next/server";
import {
  getApiKeys,
  createApiKey,
  getApiKeysUsageSummary,
  buildApiKeyLimitPresentation,
} from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";

function parseLimit(body) {
  if (!body || body.limitEnabled !== true) return null;
  return {
    metricType: body.metricType,
    periodType: body.periodType,
    limitValue: body.limitValue,
  };
}

async function decorateKeys(keys) {
  const summaries = await getApiKeysUsageSummary(keys);
  const byId = new Map(summaries.map((entry) => [entry.apiKeyId, entry.summary]));
  return keys.map((key) =>
    buildApiKeyLimitPresentation(key, byId.get(key.id) || null),
  );
}

function buildValidationError(message) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function isLimitRequestInvalid(body) {
  if (body.limitEnabled !== true) return null;
  if (!body.metricType) return "Metric type is required";
  if (!body.periodType) return "Period type is required";
  if (body.limitValue === undefined || body.limitValue === null || body.limitValue === "") {
    return "Limit value is required";
  }
  return null;
}

function buildCreatePayload(apiKey) {
  return {
    key: apiKey.key,
    name: apiKey.name,
    id: apiKey.id,
    machineId: apiKey.machineId,
    isActive: apiKey.isActive,
    createdAt: apiKey.createdAt,
    limit: apiKey.limit,
  };
}

function normalizeCreateName(name) {
  return typeof name === "string" ? name.trim() : "";
}

function parseCreateBody(body) {
  return {
    name: normalizeCreateName(body?.name),
    limit: parseLimit(body),
  };
}

function validateCreateBody(body) {
  if (!body.name) return "Name is required";
  return isLimitRequestInvalid(body);
}

export const dynamic = "force-dynamic";

// GET /api/keys - List API keys
export async function GET() {
  try {
    const keys = await getApiKeys();
    return NextResponse.json({ keys: await decorateKeys(keys) });
  } catch (error) {
    console.log("Error fetching keys:", error);
    return NextResponse.json(
      { error: "Failed to fetch keys" },
      { status: 500 },
    );
  }
}

// POST /api/keys - Create new API key
export async function POST(request) {
  try {
    const rawBody = await request.json();
    const parsedBody = parseCreateBody(rawBody);
    const validationError = validateCreateBody({ ...rawBody, name: parsedBody.name });

    if (validationError) {
      return buildValidationError(validationError);
    }

    const machineId = await getConsistentMachineId();
    const apiKey = await createApiKey(parsedBody.name, machineId, {
      limit: parsedBody.limit,
    });

    return NextResponse.json(buildCreatePayload(apiKey), { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create key" },
      { status: 500 },
    );
  }
}
