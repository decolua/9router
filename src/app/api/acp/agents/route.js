// Ported from OmniRoute src/app/api/acp/agents/route.ts (adapted to fork conventions:
// requireApiKey auth instead of isAuthenticated; manual validation instead of zod;
// settings via @/lib/localDb).
import { NextResponse } from "next/server";
import {
  detectInstalledAgents,
  refreshAgentCache,
  resolveVersionProbe,
  setCustomAgents,
} from "@/lib/acp/registry.js";
import { getSettings, updateSettings } from "@/lib/localDb";
import { extractApiKey, isValidApiKey } from "@/sse/services/auth.js";

export const dynamic = "force-dynamic";

async function checkAuth(request) {
  const settings = await getSettings();
  if (!settings.requireApiKey) return true;
  const apiKey = extractApiKey(request);
  if (!apiKey) return false;
  return isValidApiKey(apiKey);
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/** GET /api/acp/agents — list built-in + custom CLI agents with install status. */
export async function GET(request) {
  if (!(await checkAuth(request))) return unauthorized();

  try {
    const settings = await getSettings();
    if (settings.customAgents) setCustomAgents(settings.customAgents);

    const agents = detectInstalledAgents();
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
export async function POST(request) {
  if (!(await checkAuth(request))) return unauthorized();

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    if (body.action === "refresh") {
      const agents = refreshAgentCache();
      return NextResponse.json({ agents, refreshed: true });
    }

    const { id, name, binary, versionCommand, providerAlias, spawnArgs, protocol } = body;
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
      id: String(id).toLowerCase().replace(/[^a-z0-9-]/g, "-"),
      name,
      binary,
      versionCommand,
      providerAlias: providerAlias || id,
      spawnArgs: Array.isArray(spawnArgs) ? spawnArgs : [],
      protocol: protocol || "stdio",
    };

    if (!resolveVersionProbe(newAgent.binary, newAgent.versionCommand, true)) {
      return NextResponse.json(
        { error: "Invalid versionCommand: use the configured binary with plain arguments only" },
        { status: 400 }
      );
    }

    const settings = await getSettings();
    const current = settings.customAgents || [];
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
export async function DELETE(request) {
  if (!(await checkAuth(request))) return unauthorized();

  try {
    const agentId = new URL(request.url).searchParams.get("id");
    if (!agentId) return NextResponse.json({ error: "Missing agent id" }, { status: 400 });

    const settings = await getSettings();
    const current = settings.customAgents || [];
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
