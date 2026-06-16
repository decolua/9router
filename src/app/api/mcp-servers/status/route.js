import { getMcpServers } from "@/models";
import { getServerManagerStatus } from "@/lib/mcp/mcpServerManager";
const bridge = require("@/lib/mcp/stdioSseBridge");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/mcp-servers/status - Health and status of all MCP servers
export async function GET() {
  const servers = await getMcpServers();
  const managerStatus = getServerManagerStatus();
  const bridgeStatus = bridge.getStatus();

  return Response.json({
    servers: servers.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      isActive: s.isActive,
      lastConnectedAt: s.lastConnectedAt,
    })),
    processes: managerStatus.processes,
    bridgeProcesses: bridgeStatus,
    cooldowns: managerStatus.cooldowns,
    activeSessions: managerStatus.sessions,
    timestamp: new Date().toISOString(),
  });
}
