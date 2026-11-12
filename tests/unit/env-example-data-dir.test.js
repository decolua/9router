// DF-9ROUTER-8 / DF-9ROUTER-12 / DF-9ROUTER-17:
// `.env.example` is the documented contract file every quickstart copies
// verbatim (`cp .env.example .env`). It used to activate
// `DATA_DIR=/var/lib/9router` — a root-owned path an unprivileged user cannot
// create — so every documented source flow failed for a normal user:
// dev exited with EACCES after briefly printing Ready, the production build
// died during page-data collection, and `npm run cli:pack` failed too.
// The workaround (an undocumented `DATA_DIR=<writable>` override) is what these
// tests remove the need for.
//
// Contract pinned here: any ACTIVE (uncommented) `DATA_DIR` assignment in
// `.env.example` must name a path the runtime user can create and write, and
// must never be a system-owned absolute path such as `/var/lib/...` or
// `/app/...`. Commented assignments are documentation (a template for the
// operator) and are deliberately allowed.
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const ENV_EXAMPLE_URL = new URL("../../.env.example", import.meta.url);
const raw = fs.readFileSync(ENV_EXAMPLE_URL, "utf8");
const lines = raw.split("\n");

// Assignment syntax honored by @next/env: `KEY=value`, uncommented, at the
// start of a line (leading whitespace allowed).
const ACTIVE_DATA_DIR = /^\s*DATA_DIR\s*=\s*(.*)$/;
const COMMENTED_DATA_DIR = /^\s*#\s*DATA_DIR\s*=/;

const activeAssignments = lines
  .map((text, i) => ({ text, line: i + 1 }))
  .filter(({ text }) => !/^\s*[#;]/.test(text) && ACTIVE_DATA_DIR.test(text))
  .map(({ text, line }) => ({ line, value: text.match(ACTIVE_DATA_DIR)[1].trim() }));

// Absolute locations no unprivileged runtime user can create: a source install
// must never hand one of these to a normal user. `/app` is the container image
// path — docker-compose.yml sets `DATA_DIR=/app/data` itself via `environment:`,
// so the example file must not activate it for host installs either.
const SYSTEM_OWNED_ROOTS = [
  "/app",
  "/var/lib",
  "/var/www",
  "/var/log",
  "/etc",
  "/root",
  "/usr",
  "/boot",
  "/sys",
  "/proc",
  "/dev",
];

// Writable without creating anything: walk up to the deepest EXISTING ancestor
// and check write access there — that is exactly where the pre-fix
// `/var/lib/9router` failure lived (EACCES creating a child of `/var/lib`).
// This is a live-host check, so it is honest about "can this user write";
// the SYSTEM_OWNED_ROOTS list above is the host-independent guard.
function probeWritable(target) {
  let probe = path.resolve(target);
  for (;;) {
    if (fs.existsSync(probe)) {
      try {
        fs.accessSync(probe, fs.constants.W_OK);
        return { ok: true, reason: `nearest existing ancestor is writable: ${probe}` };
      } catch (e) {
        return { ok: false, reason: `nearest existing ancestor ${probe} is not writable (${e.code ?? "EACCES"})` };
      }
    }
    const parent = path.dirname(probe);
    if (parent === probe) return { ok: false, reason: `no existing ancestor for ${target}` };
    probe = parent;
  }
}

function classifyDataDir(value) {
  if (!value) return { ok: false, reason: "empty DATA_DIR assignment" };

  // Node's fs does NOT expand `~`: activating `DATA_DIR=~/.9router` would
  // create a directory literally named `~`. `~` must stay unset (default) or be
  // written as a real absolute path.
  if (value.startsWith("~")) {
    return { ok: false, reason: `"${value}" is a literal ~ path — Node fs does not expand "~"` };
  }

  const isAbsolute = value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
  if (isAbsolute) {
    const owned = SYSTEM_OWNED_ROOTS.find(
      (root) => value === root || value.startsWith(root + "/")
    );
    if (owned) {
      return { ok: false, reason: `"${value}" is under the system-owned root ${owned}` };
    }
  }

  // A Unix absolute path on a Windows host is not creatable there (the runtime
  // ignores it and silently falls back — the class of bug this task removes).
  if (process.platform === "win32" && value.startsWith("/")) {
    return { ok: false, reason: `"${value}" is a Unix path on Windows — not creatable` };
  }

  return probeWritable(value);
}

describe(".env.example DATA_DIR contract (DF-9ROUTER-8)", () => {
  it("activates no system-owned DATA_DIR a normal user cannot create", () => {
    const offenders = activeAssignments
      .map((a) => ({ ...a, ...classifyDataDir(a.value) }))
      .filter((a) => !a.ok);

    expect(
      offenders.map((a) => `line ${a.line}: DATA_DIR=${a.value} — ${a.reason}`),
      "an ACTIVE DATA_DIR in .env.example must be creatable and writable by the runtime user"
    ).toEqual([]);
  });

  it("never activates /var/lib or /app (the paths named in the dogfood findings)", () => {
    const offenders = activeAssignments.filter(
      (a) => a.value === "/var/lib" || a.value.startsWith("/var/lib/") ||
             a.value === "/app" || a.value.startsWith("/app/")
    );
    expect(offenders.map((a) => `line ${a.line}: DATA_DIR=${a.value}`)).toEqual([]);
  });

  it("documents the opt-in contract next to DATA_DIR (default + writability requirement)", () => {
    const index = lines.findIndex((l) => COMMENTED_DATA_DIR.test(l) || ACTIVE_DATA_DIR.test(l));
    expect(index, "DATA_DIR must be documented in .env.example").toBeGreaterThan(-1);

    // The comment block directly above the (commented-out) assignment is where
    // the contract lives: the per-user default and the writability requirement.
    // Walk up over the contiguous comment/blank run so the whole DATA_DIR block
    // is inspected regardless of how the comment is wrapped.
    let start = index;
    while (start > 0 && /^\s*(#|$)/.test(lines[start - 1])) start -= 1;
    const context = lines.slice(start, index + 1).join("\n");
    expect(context).toMatch(/~\/\.9router/);
    expect(context).toMatch(/optional/i);
    expect(context).toMatch(/writ/i);
    expect(context).toMatch(/docker/i);
  });

  it("keeps a commented DATA_DIR template available for opt-in", () => {
    // The assignment is not deleted, only de-activated: operators
    // (systemd/Docker-less VPS installs) still get a copy-paste starting point.
    expect(lines.some((l) => COMMENTED_DATA_DIR.test(l))).toBe(true);
  });

  it("keeps the other required assignments active", () => {
    for (const key of ["JWT_SECRET", "INITIAL_PASSWORD", "PORT", "API_KEY_SECRET", "FEDERATION_TOKEN"]) {
      const active = lines.some((l) => !/^\s*[#;]/.test(l) && new RegExp(`^\\s*${key}\\s*=`).test(l));
      expect(active, `${key} must stay an active assignment in .env.example`).toBe(true);
    }
  });
});
