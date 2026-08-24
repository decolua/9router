import os from "node:os";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const memory = process.memoryUsage();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  return NextResponse.json({
    timestamp: new Date().toISOString(),
    platform: `${os.platform()} ${os.arch()}`,
    hostname: os.hostname(),
    node: process.version,
    uptimeSeconds: Math.round(process.uptime()),
    systemUptimeSeconds: Math.round(os.uptime()),
    cpuCount: os.cpus().length,
    loadAverage: os.loadavg(),
    memory: {
      totalBytes: totalMemory,
      freeBytes: freeMemory,
      usedBytes: Math.max(0, totalMemory - freeMemory),
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      externalBytes: memory.external,
    },
  });
}
