import { statfs } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function getSystemDiskPath() {
  if (process.platform !== "win32") return "/";
  const systemDrive = String(process.env.SystemDrive || "").trim();
  if (/^[a-z]:$/i.test(systemDrive)) return `${systemDrive}\\`;
  return path.parse(process.cwd()).root || "C:\\";
}

async function getSystemDiskMetrics() {
  const mount = getSystemDiskPath();
  try {
    const stats = await statfs(mount);
    const blockSize = Number(stats.bsize || 0);
    const totalBytes = Number(stats.blocks || 0) * blockSize;
    const freeBytes = Number(stats.bavail ?? stats.bfree ?? 0) * blockSize;
    if (!Number.isFinite(totalBytes) || totalBytes <= 0 || !Number.isFinite(freeBytes)) {
      return { mount, available: false };
    }
    const normalizedFreeBytes = Math.min(totalBytes, Math.max(0, freeBytes));
    return {
      mount,
      available: true,
      totalBytes,
      freeBytes: normalizedFreeBytes,
      usedBytes: Math.max(0, totalBytes - normalizedFreeBytes),
    };
  } catch {
    return { mount, available: false };
  }
}

export async function GET() {
  const memory = process.memoryUsage();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const disk = await getSystemDiskMetrics();
  return NextResponse.json({
    timestamp: new Date().toISOString(),
    platform: `${os.platform()} ${os.arch()}`,
    hostname: os.hostname(),
    node: process.version,
    uptimeSeconds: Math.round(process.uptime()),
    systemUptimeSeconds: Math.round(os.uptime()),
    cpuCount: os.cpus().length,
    loadAverage: os.loadavg(),
    disk,
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
