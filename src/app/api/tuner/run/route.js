import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { canEditCombos } from "../auth";

export const dynamic = "force-dynamic";

const execFileP = promisify(execFile);
const DATA_DIR = process.env.DATA_DIR || "/app/data";
const TUNER_DIR = "/app/tuner";
const BENCH_PATH = path.join(TUNER_DIR, "bench.json");
const STATE_PATH = path.join(DATA_DIR, "tuner", "state.json");
const TUNE_SCRIPT = path.join(TUNER_DIR, "tune.mjs");
const PORT = process.env.PORT || 20128;

const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });

function parseDuration(raw) {
  const ms = Number(raw);
  if (Number.isFinite(ms) && ms > 0) return Math.min(ms, 300_000); // cap 5 min
  return 30_000;
}

function readState() {
  try {
    const raw = fs.readFileSync(STATE_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return { ranAt: null, dryRun: true, combos: {}, scores: {}, lastApplied: {} };
  }
}

export async function POST(request) {
  if (!(await canEditCombos())) return unauthorized();

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const apply = body.apply === true;

  if (apply && body.confirm !== true) {
    return NextResponse.json(
      { error: "apply=true requires confirm=true" },
      { status: 400 },
    );
  }

  const timeoutMs = parseDuration(body.timeoutMs);

  try {
    const { stdout, stderr } = await execFileP("node", [TUNE_SCRIPT], {
      env: {
        ...process.env,
        DATA_DIR,
        BENCH_PATH,
        STATE_PATH,
        DRY_RUN: apply ? "false" : "true",
        NINEROUTER_URL: `http://localhost:${PORT}`,
        NINEROUTER_DASHBOARD_PASSWORD: process.env.NINEROUTER_DASHBOARD_PASSWORD || "",
      },
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    });

    const state = readState();
    const applied = state.combos
      ? Object.values(state.combos).some((c) => c.applied === true)
      : false;

    return NextResponse.json({
      ok: true,
      applied,
      stdout: stdout || "(no stdout)",
      stderr: stderr || "",
    });
  } catch (error) {
    const stderr = error.stderr || "";
    if (error.killed) {
      return NextResponse.json(
        { ok: false, applied: false, stdout: "", stderr: `Timeout after ${timeoutMs}ms\n${stderr}` },
        { status: 504 },
      );
    }
    console.log("tuner run error:", error);
    return NextResponse.json(
      { ok: false, applied: false, stdout: error.stdout || "", stderr: stderr || error.message },
      { status: 500 },
    );
  }
}
