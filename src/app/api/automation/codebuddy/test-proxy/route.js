import { NextResponse } from "next/server";
import { spawnSync } from "child_process";
import path from "path";

export const dynamic = "force-dynamic";

const SCRIPT = path.join(process.cwd(), "src/automation/test_proxy.py");

function getVenvPython() {
  const venvPy = path.join(process.cwd(), ".venv/bin/python3");
  try {
    const r = spawnSync(venvPy, ["--version"], { timeout: 3000 });
    if (r.status === 0) return venvPy;
  } catch {}
  return "python3";
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { proxy } = body;
    if (!proxy || typeof proxy !== "string") {
      return NextResponse.json({ ok: false, error: "No proxy provided" }, { status: 400 });
    }

    const python = getVenvPython();
    const result = spawnSync(python, [
      SCRIPT,
      "--proxy", proxy.trim(),
      "--headless",
    ], {
      timeout: 35000,
      encoding: "utf-8",
      env: { ...process.env, DISPLAY: process.env.DISPLAY || ":1" },
    });

    const stdout = (result.stdout || "").trim();
    const stderr = (result.stderr || "").trim();

    if (!stdout) {
      return NextResponse.json({
        ok: false,
        error: stderr || `Script error (exit ${result.status})`,
      });
    }

    try {
      const data = JSON.parse(stdout);
      return NextResponse.json(data);
    } catch {
      return NextResponse.json({ ok: false, error: stdout.substring(0, 200) });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
