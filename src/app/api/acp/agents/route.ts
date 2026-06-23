// Ported from OmniRoute src/app/api/acp/agents/route.ts (adapted to fork conventions:
// requireApiKey auth instead of isAuthenticated; manual validation instead of zod;
// settings via @/lib/localDb).
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { JsonValue } from "open-sse/types/executor.js";
import {
  detectInstalledAgents,
  refreshAgentCache,
  resolveVersionProbe,
  setCustomAgents,
} from "@/lib/acp/registry.js";
import { getSettings, updateSettings } from "@/lib/localDb";
import { extractApiKey, isValidApiKey } from "@/sse/services/auth.js";

export const dynamic = "force-dynamic";

// Minimal shape a persisted custom-agent entry must satisfy to be trusted.
type CustomAgent = { id: string; name: string; binary: string; versionCommand: string; providerAlias: string; spawnArgs: string[]; protocol: string };
// Shape returned by detectInstalledAgents() / refreshAgentCache() (JS, no .d.ts).
type DetectedAgent = { id: string; installed: boolean; isCustom: boolean; [key: string]: unknown };

function toCustomAgents(raw: JsonValue | undefined) {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (
      entry === null ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      typeof entry.id !== "string" ||
      typeof entry.name !== "string" ||
      typeof entry.binary !== "string" ||
      typeof entry.versionCommand !== "string"
    ) return [];
    const rawArgs = entry.spawnArgs;
    const spawnArgs = Array.isArray(rawArgs)
      ? rawArgs.flatMap((s) => typeof s === "string" ? [s] : [])
      : [];
    const a: CustomAgent = {
      id: entry.id,
      name: entry.name,
      binary: entry.binary,
      versionCommand: entry.versionCommand,
      providerAlias: typeof entry.providerAlias === "string" ? entry.providerAlias : entry.id,
      spawnArgs,
      protocol: typeof entry.protocol === "string" ? entry.protocol : "stdio",
    };
    return [a];
  });
}

// Single cast boundary: settings.customAgents is unknown (open Settings shape);
// we narrow once here so all three handlers stay cast-free.
function getCustomAgents(settings: Awaited<ReturnType<typeof getSettings>>) {
  return toCustomAgents(settings.customAgents as JsonValue | undefined);
}

async function checkAuth(request: NextRequest) {
  const settings = await getSettings();
  if (!settings.requireApiKey) return true;
  const apiKey = extractApiKey(request);
  if (!apiKey) return false;
  return isValidApiKey(apiKey);
}

/** GET /api/acp/agents — list built-in + custom CLI agents with install status. */
export async function GET(request: NextRequest) {
  if (!(await checkAuth(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const settings = await getSettings();
    const knownAgents = getCustomAgents(settings);
    if (knownAgents.length > 0) setCustomAgents(knownAgents);

    const agents = detectInstalledAgents() as DetectedAgent[];
    const installed = agents.filter((a) => a.installed).length;
    const total = agents.length;

    return NextResponse.json({
      agents,
      summary: {
        total,
        installed,
        notFound: total - installed,
        builtIn: agents.filter((a) => !a.isCustom).length,
        custom: agents.filter((a) => a.isCustom).length,
      },
    });
  } catch (error) {
    console.error("Error detecting agents:", error);
    return NextResponse.json({ error: "Failed to detect agents" }, { status: 500 });
  }
}

/** POST /api/acp/agents — add a custom agent, or {action:"refresh"} to re-detect. */
export async function POST(request: NextRequest) {
  if (!(await checkAuth(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let parsed: JsonValue;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 });
  }
  const body = parsed;

  try {
    if (body["action"] === "refresh") {
      const agents = refreshAgentCache();
      return NextResponse.json({ agents, refreshed: true });
    }

    const id = typeof body["id"] === "string" ? body["id"] : null;
    const name = typeof body["name"] === "string" ? body["name"] : null;
    const binary = typeof body["binary"] === "string" ? body["binary"] : null;
    const versionCommand = typeof body["versionCommand"] === "string" ? body["versionCommand"] : null;
    const providerAlias = typeof body["providerAlias"] === "string" ? body["providerAlias"] : null;
    const protocol = typeof body["protocol"] === "string" ? body["protocol"] : null;
    const spawnArgs =
      Array.isArray(body["spawnArgs"]) && body["spawnArgs"].every((a) => typeof a === "string")
        ? (body["spawnArgs"] as string[])
        : [];

    if (!id || !name || !binary || !versionCommand) {
      return NextResponse.json(
        { error: "Missing required fields: id, name, binary, versionCommand" },
        { status: 400 }
      );
    }
    if (protocol && !["stdio", "http"].includes(protocol)) {
      return NextResponse.json({ error: "protocol must be 'stdio' or 'http'" }, { status: 400 });
    }

    const newAgent = {
      id: id.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
      name,
      binary,
      versionCommand,
      providerAlias: providerAlias ?? id,
      spawnArgs,
      protocol: protocol ?? "stdio",
    };

    if (!resolveVersionProbe(newAgent.binary, newAgent.versionCommand, true)) {
      return NextResponse.json(
        { error: "Invalid versionCommand: use the configured binary with plain arguments only" },
        { status: 400 }
      );
    }

    const settings = await getSettings();
    const current = getCustomAgents(settings);
    if (current.some((a) => a.id === newAgent.id)) {
      return NextResponse.json({ error: `Agent with id '${newAgent.id}' already exists` }, { status: 409 });
    }

    const updated = [...current, newAgent];
    await updateSettings({ customAgents: updated });
    setCustomAgents(updated);

    const agents = refreshAgentCache();
    return NextResponse.json({ agents, added: newAgent });
  } catch (error) {
    console.error("Error adding custom agent:", error);
    return NextResponse.json({ error: "Failed to add agent" }, { status: 500 });
  }
}

/** DELETE /api/acp/agents?id=... — remove a custom agent. */
export async function DELETE(request: NextRequest) {
  if (!(await checkAuth(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const agentId = new URL(request.url).searchParams.get("id");
    if (!agentId) return NextResponse.json({ error: "Missing agent id" }, { status: 400 });

    const settings = await getSettings();
    const current = getCustomAgents(settings);
    const updated = current.filter((a) => a.id !== agentId);

    if (updated.length === current.length) {
      return NextResponse.json({ error: `Agent '${agentId}' not found in custom agents` }, { status: 404 });
    }

    await updateSettings({ customAgents: updated });
    setCustomAgents(updated);
    const agents = refreshAgentCache();
    return NextResponse.json({ agents, removed: agentId });
  } catch (error) {
    console.error("Error removing custom agent:", error);
    return NextResponse.json({ error: "Failed to remove agent" }, { status: 500 });
  }
}
