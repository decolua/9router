import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { join, dirname } from "path";
import os from "os";
import { setRemoteProcess } from "@/lib/9remoteManager";
import { isNineRemoteEnabled } from "@/lib/nineRemoteConfig";

const bin9remote = join(dirname(process.execPath), "9remote");

export async function POST() {
  if (!isNineRemoteEnabled()) {
    return NextResponse.json({ ok: false, error: "9Remote is disabled" }, { status: 404 });
  }

  try {
    const nodeDir = dirname(process.execPath);
    const existingPath = process.env.PATH || "";
    const path = existingPath.includes(nodeDir)
      ? existingPath
      : `${nodeDir}:${existingPath}`;

    const env = {
      HOME: os.homedir(),
      PATH: path,
      USER: process.env.USER || process.env.LOGNAME,
      LANG: process.env.LANG || "en_US.UTF-8",
      TERM: process.env.TERM || "xterm-256color",
      TMPDIR: process.env.TMPDIR || os.tmpdir(),
      SHELL: process.env.SHELL,
    };
    const home = os.homedir();

    // Spawn without detached - process will be child of Next.js and receive SIGTERM
    const child = spawn(bin9remote, ["ui", "--start"], {
      cwd: home,
      stdio: "ignore",
      env,
      windowsHide: process.platform === "win32",
    });

    // Store child process for manual cleanup if needed
    setRemoteProcess(child);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
