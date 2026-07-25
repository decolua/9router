import { NextResponse } from "next/server";
import { execSync } from "node:child_process";

export const dynamic = "force-dynamic";

function run(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", timeout: 10000 }).trim();
  } catch {
    return "";
  }
}

export async function GET() {
  try {
    const psRaw = run('docker ps -a --format "{{json .}}"');
    const containers = psRaw
      ? psRaw.split("\n").filter(Boolean).map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        }).filter(Boolean)
      : [];

    if (containers.length === 0) {
      return NextResponse.json({ containers: [], host: null });
    }

    const statsRaw = run('docker stats --no-stream --format "{{json .}}"');
    const statsMap = {};
    if (statsRaw) {
      statsRaw.split("\n").filter(Boolean).forEach((line) => {
        try {
          const s = JSON.parse(line);
          statsMap[s.ID] = s;
        } catch {}
      });
    }

    const infoRaw = run('docker info --format "{{json .}}"');
    let host = null;
    if (infoRaw) {
      try {
        const info = JSON.parse(infoRaw);
        host = {
          ncpu: info.NCPU,
          memTotal: info.MemTotal,
          os: info.OperatingSystem,
          arch: info.Architecture,
        };
      } catch {}
    }

    const result = containers.map((c) => {
      const stat = statsMap[c.ID] || {};
      return {
        id: c.ID,
        name: (c.Names || "").replace(/^\//, ""),
        image: c.Image,
        command: c.Command,
        state: c.State,
        status: c.Status,
        ports: c.Ports,
        created: c.CreatedAt,
        runningFor: c.RunningFor,
        size: c.Size,
        cpuPerc: stat.CPUPerc || "",
        memUsage: stat.MemUsage || "",
        memPerc: stat.MemPerc || "",
        netIO: stat.NetIO || "",
        blockIO: stat.BlockIO || "",
        pids: stat.PIDs || "",
      };
    });

    return NextResponse.json({ containers: result, host });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
