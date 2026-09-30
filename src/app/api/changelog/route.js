import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

const OFFICIAL_URL = "https://raw.githubusercontent.com/decolua/9router/refs/heads/master/CHANGELOG.md";

// This repo's own CHANGELOG.md is the fork's (Serenhope) changelog; the official one lives upstream.
function readLocalChangelog() {
  try {
    const text = fs.readFileSync(path.join(process.cwd(), "CHANGELOG.md"), "utf8");
    return text.trim() ? text : null;
  } catch {
    // Missing in bundled/standalone runtimes — not an error, the caller falls back.
    return null;
  }
}

async function fetchOfficialChangelog() {
  try {
    const res = await fetch(OFFICIAL_URL, { cache: "no-store", signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const text = await res.text();
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

// GET /api/changelog - { official, custom } markdown, served from disk so the modal works offline.
export async function GET() {
  const custom = readLocalChangelog();
  const official = await fetchOfficialChangelog();

  if (!official && !custom) {
    return NextResponse.json({ ok: false, official: null, custom: null });
  }
  return NextResponse.json({ ok: true, official, custom });
}
