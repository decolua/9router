import { NextResponse } from "next/server";
import {
  getMcpServerById,
  updateMcpServer,
  deleteMcpServer,
  testMcpServer,
  sanitizeMcpServer,
} from "@/models";
import {
  validateLocalStdioServer,
  invalidateToolsListCache,
  notifyToolsListChanged,
} from "@/lib/mcp";

export const dynamic = "force-dynamic";

// GET /api/mcp-servers/[id] - Get single server
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const server = await getMcpServerById(id);
    if (!server) {
      return NextResponse.json(
        { error: "MCP server not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ server: sanitizeMcpServer(server) });
  } catch (error) {
    console.error("Error fetching MCP server:", error);
    return NextResponse.json(
      { error: "Failed to fetch MCP server" },
      { status: 500 },
    );
  }
}

// PUT /api/mcp-servers/[id] - Update server
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const {
      name,
      type,
      url,
      command,
      args,
      env,
      headers,
      description,
      toolNames,
      isActive,
      prefix,
    } = body;

    const server = await getMcpServerById(id);
    if (!server) {
      return NextResponse.json(
        { error: "MCP server not found" },
        { status: 404 },
      );
    }

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (type !== undefined) updates.type = type;
    if (url !== undefined) updates.url = url;
    if (command !== undefined) updates.command = command;
    if (args !== undefined) updates.args = args;
    if (env !== undefined) updates.env = env;
    if (headers !== undefined) updates.headers = headers;
    if (description !== undefined) updates.description = description;
    if (toolNames !== undefined) updates.toolNames = toolNames;
    if (isActive !== undefined) updates.isActive = isActive;
    if (prefix !== undefined) updates.prefix = prefix;

    const validation = validateLocalStdioServer({ ...server, ...updates });
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const updated = await updateMcpServer(id, updates);
    invalidateToolsListCache();
    // If the server's active state changed, the exposed tool set changed too —
    // tell connected MCP clients to refresh.
    if (updates.isActive !== undefined && updates.isActive !== server.isActive) {
      notifyToolsListChanged();
    } else if (updates.toolNames !== undefined) {
      notifyToolsListChanged();
    }
    return NextResponse.json({ server: sanitizeMcpServer(updated) });
  } catch (error) {
    console.error("Error updating MCP server:", error);
    return NextResponse.json(
      { error: "Failed to update MCP server" },
      { status: 500 },
    );
  }
}

// DELETE /api/mcp-servers/[id] - Delete server
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const deleted = await deleteMcpServer(id);
    if (!deleted) {
      return NextResponse.json(
        { error: "MCP server not found" },
        { status: 404 },
      );
    }
    invalidateToolsListCache();
    notifyToolsListChanged();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting MCP server:", error);
    return NextResponse.json(
      { error: "Failed to delete MCP server" },
      { status: 500 },
    );
  }
}
