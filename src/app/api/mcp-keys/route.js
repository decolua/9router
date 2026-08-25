import { NextResponse } from "next/server";
import { getApiKeys, createApiKey } from "@/lib/db/repos/apiKeysRepo.js";
import { getConsistentMachineId } from "@/shared/utils/machineId.js";
import {
  hasDashboardOrCliAuth,
  unauthorizedResponse,
} from "@/lib/auth/dashboardApiAuth";

// GET /api/mcp-keys - List MCP API keys
export async function GET(request) {
  try {
    // Require dashboard or CLI authentication
    if (!(await hasDashboardOrCliAuth(request))) {
      return unauthorizedResponse();
    }

    const keys = await getApiKeys("mcp");
    return NextResponse.json({ keys });
  } catch (error) {
    console.error("Error fetching MCP API keys:", error);
    return NextResponse.json(
      { error: "Failed to fetch MCP API keys" },
      { status: 500 },
    );
  }
}

// POST /api/mcp-keys - Create new MCP API key
export async function POST(request) {
  try {
    // Require dashboard or CLI authentication
    if (!(await hasDashboardOrCliAuth(request))) {
      return unauthorizedResponse();
    }

    const body = await request.json();
    const { name } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const machineId = await getConsistentMachineId();
    const apiKey = await createApiKey(name, machineId, "mcp");

    return NextResponse.json({ key: apiKey }, { status: 201 });
  } catch (error) {
    console.error("Error creating MCP API key:", error);
    return NextResponse.json(
      { error: "Failed to create MCP API key" },
      { status: 500 },
    );
  }
}
