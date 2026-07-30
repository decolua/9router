import { NextResponse } from "next/server";
import { getProviderConnections } from "@/models";
import {
  listProjects,
  validateProject,
  generateCloudShellUrl,
  checkProjectExists,
} from "open-sse/services/gcpProjects.js";

export const dynamic = "force-dynamic";

/**
 * Helper: get an Antigravity OAuth access token from the DB.
 * Tries the first active antigravity or gemini-cli connection.
 */
async function getAntigravityToken() {
  const connections = await getProviderConnections();
  const conn = connections.find(
    (c) =>
      (c.provider === "antigravity" || c.provider === "gemini-cli") &&
      c.isActive &&
      c.accessToken
  );
  if (!conn) return null;
  return { token: conn.accessToken, connectionId: conn.id };
}

// ─── GET /api/gcp-projects ────────────────────────────────────────────────────
// Returns list of user's active GCP projects + a Cloud Shell URL for creating one
export async function GET(request) {
  const creds = await getAntigravityToken();
  if (!creds) {
    return NextResponse.json(
      { projects: [], error: "No active Antigravity connection found." },
      { status: 200 }
    );
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");

  // Action: generate Cloud Shell URL
  if (action === "cloud-shell-url") {
    const { url, projectId } = generateCloudShellUrl();
    return NextResponse.json({ url, projectId });
  }

  // Action: poll for a specific project
  if (action === "check") {
    const targetId = searchParams.get("projectId");
    if (!targetId) {
      return NextResponse.json({ found: false, error: "Missing projectId param" });
    }
    const found = await checkProjectExists(creds.token, targetId);
    return NextResponse.json({ found: !!found, projectId: found });
  }

  // Default: list all projects
  const projects = await listProjects(creds.token);
  return NextResponse.json({ projects });
}

// ─── POST /api/gcp-projects ──────────────────────────────────────────────────
// Validate and save a project ID to the Antigravity connection
export async function POST(request) {
  const creds = await getAntigravityToken();
  if (!creds) {
    return NextResponse.json(
      { valid: false, message: "No active Antigravity connection." },
      { status: 401 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { valid: false, message: "Invalid JSON." },
      { status: 400 }
    );
  }

  const { projectId } = body;
  const result = await validateProject(creds.token, projectId);

  if (result.valid) {
    // Save project ID to the Antigravity connection in SQLite
    const { updateProviderConnection } = await import("@/models");
    await updateProviderConnection(creds.connectionId, { projectId });
  }

  return NextResponse.json(result);
}
