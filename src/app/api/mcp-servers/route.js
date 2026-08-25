import { NextResponse } from "next/server";
import { getMcpServers, createMcpServer, sanitizeMcpServer } from "@/models";
import {
  validateLocalStdioServer,
  invalidateToolsListCache,
  notifyToolsListChanged,
} from "@/lib/mcp";

export const dynamic = "force-dynamic";

// GET /api/mcp-servers - List all MCP servers
export async function GET() {
  try {
    const servers = await getMcpServers();
    return NextResponse.json({ servers: servers.map(sanitizeMcpServer) });
  } catch (error) {
    console.error("Error fetching MCP servers:", error);
    return NextResponse.json(
      { error: "Failed to fetch MCP servers" },
      { status: 500 },
    );
  }
}

// POST /api/mcp-servers - Create new MCP server
export async function POST(request) {
  try {
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
      prefix,
    } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const validTypes = ["remote-http", "remote-sse", "local-stdio"];
    if (type && !validTypes.includes(type)) {
      return NextResponse.json(
        { error: `Invalid type. Must be one of: ${validTypes.join(", ")}` },
        { status: 400 },
      );
    }

    if ((type === "remote-http" || type === "remote-sse") && !url) {
      return NextResponse.json(
        { error: "URL is required for remote servers" },
        { status: 400 },
      );
    }

    if (type === "local-stdio" && !command) {
      return NextResponse.json(
        { error: "Command is required for local stdio servers" },
        { status: 400 },
      );
    }

    const validation = validateLocalStdioServer({ type, command, args, env });
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const server = await createMcpServer({
      name,
      type: type || "remote-http",
      url,
      command,
      args: args || [],
      env: env || {},
      headers: headers || {},
      description,
      toolNames: toolNames || [],
      prefix,
    });

    invalidateToolsListCache();
    if (server.isActive) {
      notifyToolsListChanged();
    }

    return NextResponse.json(
      { server: sanitizeMcpServer(server) },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating MCP server:", error);
    return NextResponse.json(
      { error: "Failed to create MCP server" },
      { status: 500 },
    );
  }
}
