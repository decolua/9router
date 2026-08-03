import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// GET /api/tuner — public, no auth. Returns last tuner state.
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || "/app/data";
const STATE_PATH = path.join(DATA_DIR, "tuner", "state.json");

function readState() {
  try {
    const raw = fs.readFileSync(STATE_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return { ranAt: null, dryRun: true, combos: {}, scores: {}, lastApplied: {} };
  }
}

export async function GET() {
  try {
    const state = readState();
    return NextResponse.json(state);
  } catch (error) {
    console.log("Error reading tuner state:", error);
    return NextResponse.json({ error: "Failed to read tuner state" }, { status: 500 });
  }
}
