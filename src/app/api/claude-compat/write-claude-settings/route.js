import { NextResponse } from "next/server";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { updateSettings } from "@/lib/localDb";
import {
  sanitizeDefaultModels,
  buildClaudeEnvOverrides,
  sanitizeEnvOverrides,
  mergeClaudeEnv,
} from "@/lib/claudeCompat";

export const dynamic = "force-dynamic";

// ── VERIFY_ONLY: safety gate during review ─────────────────────────────────
// true  → never touch ~/.claude/settings.json; copy it to
//         settings.json.9router.bak and write the merged result there for
//         manual review + structural validation.
// false → write the real ~/.claude/settings.json (flip after review OK).
const VERIFY_ONLY = false;

const LIVE_FILE = () => path.join(os.homedir(), ".claude", "settings.json");
const BAK_FILE = () => `${LIVE_FILE()}.9router.bak`;

// One-click write of the claude default-model mapping into the env of
// ~/.claude/settings.json (VERIFY_ONLY: into the .bak copy instead).
// Semantics are strictly key-overwrite on env: keys in the payload replace
// same-key env values; NOTHING is deleted and no non-env key is touched
// (ANTHROPIC_AUTH_TOKEN / BASE_URL / telemetry flags all survive verbatim).
// An existing file that fails to parse is never overwritten.
export async function POST(request) {
  let envOverrides;
  let defaultModels;
  try {
    const body = await request.json();
    // env comes either from the user-edited JSON blob (authoritative) or is
    // generated from the role table.
    envOverrides = body?.env
      ? sanitizeEnvOverrides(body.env)
      : buildClaudeEnvOverrides(sanitizeDefaultModels(body?.defaultModels));
    if (body?.defaultModels) defaultModels = sanitizeDefaultModels(body.defaultModels);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!envOverrides || Object.keys(envOverrides).length === 0) {
    return NextResponse.json({ error: "No env keys to write" }, { status: 400 });
  }

  const live = LIVE_FILE();
  const target = VERIFY_ONLY ? BAK_FILE() : live;
  let settingsJson = {};
  try {
    const text = await fs.readFile(live, "utf8");
    settingsJson = JSON.parse(text);
    if (!settingsJson || typeof settingsJson !== "object" || Array.isArray(settingsJson)) {
      return NextResponse.json(
        { error: `${live} is not a JSON object — refusing to overwrite` },
        { status: 409 },
      );
    }
  } catch (e) {
    if (e.code !== "ENOENT") {
      return NextResponse.json(
        { error: `${live} is unparseable (${e.message}) — refusing to overwrite` },
        { status: 409 },
      );
    }
    // No file yet — start from an empty object.
  }

  const next = mergeClaudeEnv(settingsJson, envOverrides);

  // Structural self-check before writing: the merged result must still be a
  // valid JSON object whose env is a plain object and all managed values are
  // strings. Any failure aborts the write.
  if (
    !next || typeof next !== "object" || Array.isArray(next) ||
    !next.env || typeof next.env !== "object" || Array.isArray(next.env)
  ) {
    return NextResponse.json({ error: "Merged result failed structural check" }, { status: 500 });
  }

  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, JSON.stringify(next, null, 2) + "\n", "utf8");
  } catch (e) {
    return NextResponse.json({ error: `Write failed: ${e.message}` }, { status: 500 });
  }

  // Post-write validation: re-read and re-parse what we just wrote.
  try {
    const check = JSON.parse(await fs.readFile(target, "utf8"));
    if (!check?.env || typeof check.env !== "object") throw new Error("env missing after write");
    for (const [k, v] of Object.entries(envOverrides)) {
      if (check.env[k] !== v) throw new Error(`key "${k}" mismatch after write`);
    }
  } catch (e) {
    return NextResponse.json({ error: `Post-write validation failed: ${e.message}` }, { status: 500 });
  }

  // Persist the role-table mapping (not the hand-edited env) so the dashboard
  // reloads what the table last held. Failures are non-fatal — file write done.
  if (defaultModels) {
    try {
      await updateSettings({ claudeDefaultModels: defaultModels });
    } catch (e) {
      console.error("[claude-compat] persist defaultModels failed:", e.message);
    }
  }

  return NextResponse.json({
    file: target,
    verifyOnly: VERIFY_ONLY,
    written: envOverrides,
  });
}
