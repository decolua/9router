/**
 * QA-9ROUTER-8 — the standalone Compose deployment depended exclusively on
 * third-party prebuilt images (`decolua/9router`, and the optional
 * `ghcr.io/chopratejas/headroom` sidecar) with no local-build path, so a
 * clean/rootless host whose pulls from those namespaces fail had no usable
 * deployment route: measured on a clean agent, `docker compose up -d --build`
 * aborted during the pulls while warm rootful pulls succeeded.
 *
 * The fix is deliberately minimal and backwards compatible:
 *
 *   1. `docker-compose.yml` keeps deploying the PUBLISHED images — the default
 *      render (images, `${PORT:-20128}` / `${HEADROOM_PORT:-8787}` overrides,
 *      optional `.env`, `9router-data` volume, headroom wiring) is unchanged.
 *      A plain `docker compose up -d` must never start building.
 *   2. A separate OVERRIDE file, `docker-compose.local-build.yml`, adds a
 *      `build:` for the 9router service on top of that base file, tagging the
 *      result `9router:local` (never the published tag, so a local build
 *      cannot silently replace `decolua/9router:latest` in the image cache).
 *      Compose merges the override over the base, so every port/volume/env/
 *      wiring field keeps coming from the base file.
 *   3. Headroom has no local build in this repository (third-party project) and
 *      is optional at runtime, so its fallback is the documented no-headroom
 *      run (`--no-deps 9router`), not an invented local image.
 *
 * What this file pins, offline:
 *   - the default compose contract (published images, no `build`, port
 *     overrides, optional env_file, volume, environment, headroom dependency)
 *   - the override contract (build of the repo Dockerfile, distinct local tag,
 *     no re-declaration of the base's wiring, no invented headroom service)
 *   - the documented commands (DOCKER.md + README.md) so the fallback cannot
 *     quietly rot into a dead reference
 *   - the merged renders via `docker compose config` — a client-side render
 *     that contacts no registry and needs no engine; it is skipped only when
 *     the Compose CLI itself is absent.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const BASE_FILE = "docker-compose.yml";
const OVERRIDE_FILE = "docker-compose.local-build.yml";
const BASE_PATH = path.join(REPO_ROOT, BASE_FILE);
const OVERRIDE_PATH = path.join(REPO_ROOT, OVERRIDE_FILE);
const DOCKERFILE = "Dockerfile";

const PUBLISHED_IMAGE = "decolua/9router:latest";
const HEADROOM_IMAGE = "ghcr.io/chopratejas/headroom:latest";
const LOCAL_IMAGE_TAG = "9router:local";

function readRequired(file, label) {
  expect(fs.existsSync(file), `${label} is required at ${file}`).toBe(true);
  return fs.readFileSync(file, "utf8");
}

const base = readRequired(BASE_PATH, BASE_FILE);
const override = readRequired(OVERRIDE_PATH, OVERRIDE_FILE);

/**
 * Text of one service block: from `  <name>:` up to the next service key
 * (2-space indent) or top-level key (0 indent). Indentation-based, so it needs
 * no YAML dependency.
 */
function serviceBlock(text, name) {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => new RegExp(`^\\s{2}${name}:\\s*$`).test(line));
  if (start === -1) return null;
  const block = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\S/.test(line)) break;
    if (/^\s{1,2}\S/.test(line)) break;
    block.push(line);
  }
  return block.join("\n");
}

const base9 = serviceBlock(base, "9router");
const baseHeadroom = serviceBlock(base, "headroom");
const override9 = serviceBlock(override, "9router");

/** Section of a markdown file whose `## ` heading contains `needle`. */
function markdownSection(text, needle) {
  const lines = text.split("\n");
  const start = lines.findIndex(
    (line) => /^##\s/.test(line) && line.toLowerCase().includes(needle)
  );
  if (start === -1) return null;
  const body = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s/.test(lines[i])) break;
    body.push(lines[i]);
  }
  return `${lines[start]}\n${body.join("\n")}`;
}

/** Collapse markdown wrapping so a command split over lines still matches. */
const flat = (text) => text.replace(/\s+/g, " ");

const dockerDocs = readRequired(path.join(REPO_ROOT, "DOCKER.md"), "DOCKER.md");
const readme = readRequired(path.join(REPO_ROOT, "README.md"), "README.md");

describe("docker-compose.yml — default path still deploys the published images", () => {
  it("parses both services (guards the assertions below from a vacuous block parse)", () => {
    expect(base9).toBeTruthy();
    expect(baseHeadroom).toBeTruthy();
    expect(override9).toBeTruthy();
  });

  it("keeps the published images and declares no build in the default path", () => {
    expect(base9).toContain(`image: ${PUBLISHED_IMAGE}`);
    expect(baseHeadroom).toContain(`image: ${HEADROOM_IMAGE}`);
    // A plain `docker compose up -d` must keep deploying the published images.
    // The local build lives in the opt-in override, never in the base file.
    expect(base).not.toMatch(/^\s*build:/m);
  });

  it("keeps the host-port overrides and the container-side ports", () => {
    expect(base9).toContain('- "${PORT:-20128}:20128"');
    expect(baseHeadroom).toContain('- "${HEADROOM_PORT:-8787}:8787"');
  });

  it("keeps container names, restart policy and the data volume — project-scoped, no pinned global name", () => {
    expect(base9).toContain("container_name: 9router");
    expect(base9).toMatch(/restart: always/);
    expect(base9).toContain("- 9router-data:/app/data");
    // QA-9ROUTER-32: the volume stays DECLARED but carries no explicit
    // `name:`, so compose scopes it per project (<project>_9router-data).
    // A pinned global `name: 9router-data` made unrelated checkouts share
    // (and tear down) the same volume (DF-9ROUTER-48 class).
    expect(base).toMatch(/^volumes:\n(?: {2}#[^\n]*\n)* {2}9router-data: \{\}$/m);
    expect(base).not.toMatch(/^ {4}name: 9router-data$/m);
  });

  it("keeps .env optional at config time and embeds no secret itself", () => {
    const envFile = base9.match(/env_file:[\s\S]*?required: false/);
    expect(envFile, "the optional .env env_file block must survive").toBeTruthy();
    expect(envFile[0]).toContain("path: .env");
    for (const text of [base, override]) {
      expect(text).not.toMatch(
        /^\s*(INITIAL_PASSWORD|JWT_SECRET|API_KEY_SECRET|FEDERATION_TOKEN)\s*:/m
      );
    }
  });

  it("keeps the declared environment and the headroom dependency", () => {
    for (const line of [
      "DATA_DIR: /app/data",
      'PORT: "20128"',
      'HOSTNAME: "0.0.0.0"',
      "NODE_ENV: production",
      "HEADROOM_URL: http://headroom:8787",
    ]) {
      expect(base9).toContain(line);
    }
    expect(base9).toMatch(/depends_on:\n\s*- headroom/);
  });

  it("points operators at the fallback file (discoverability at the failure site)", () => {
    expect(base).toContain(OVERRIDE_FILE);
  });
});

describe(`docker-compose.local-build.yml — opt-in local build (fallback)`, () => {
  it("builds the repo Dockerfile for the 9router service", () => {
    expect(override9).toMatch(/^ {4}build:$/m);
    expect(override9).toMatch(/^ {6}context: \.$/m);
    expect(override9).toMatch(new RegExp(`^ {6}dockerfile: ${DOCKERFILE}$`, "m"));
    // A build that names a missing Dockerfile is not a fallback.
    const dockerfilePath = path.join(REPO_ROOT, DOCKERFILE);
    expect(fs.existsSync(dockerfilePath)).toBe(true);
    expect(fs.readFileSync(dockerfilePath, "utf8")).toContain('CMD ["node", "custom-server.js"]');
  });

  it("tags the local build distinctly so it cannot replace the published tag", () => {
    expect(override9).toContain(`image: \${NINEROUTER_LOCAL_IMAGE:-${LOCAL_IMAGE_TAG}}`);
    expect(override9).not.toContain(PUBLISHED_IMAGE);
    expect(LOCAL_IMAGE_TAG).not.toBe(PUBLISHED_IMAGE);
  });

  it("re-declares none of the base wiring (compose merges it from the base file)", () => {
    // Re-declaring these in the override would let the fallback drift away from
    // the default deployment (ports, volume, env, optional .env, dependency).
    for (const key of [
      "ports",
      "volumes",
      "environment",
      "env_file",
      "depends_on",
      "container_name",
      "restart",
    ]) {
      expect(override9, `${key} must stay in ${BASE_FILE}`).not.toMatch(
        new RegExp(`^ {4}${key}:`, "m")
      );
    }
  });

  it("invents no headroom service (third-party image, optional at runtime)", () => {
    expect(serviceBlock(override, "headroom")).toBeNull();
  });
});

describe("documented fallback commands (DOCKER.md + README.md)", () => {
  const fallbackSection = markdownSection(dockerDocs, "local build");

  it("documents the exact override commands", () => {
    expect(
      fallbackSection,
      "DOCKER.md must document the local-build fallback"
    ).toBeTruthy();
    const text = flat(fallbackSection);
    expect(text).toContain(`-f ${BASE_FILE} -f ${OVERRIDE_FILE} up -d --build`);
    expect(text).toContain("--no-deps 9router");
    expect(text).toContain(LOCAL_IMAGE_TAG);
    expect(text).toContain("NINEROUTER_LOCAL_IMAGE");
  });

  it("states that headroom stays optional when its image cannot be pulled", () => {
    const text = flat(fallbackSection).toLowerCase();
    expect(text).toContain("headroom");
    expect(text).toMatch(/optional at runtime/);
    expect(text).toMatch(/no local build|omits the sidecar|sidecar omitted/);
  });

  it("keeps the same fallback discoverable from README.md", () => {
    const text = flat(readme);
    expect(text).toContain(`-f ${BASE_FILE} -f ${OVERRIDE_FILE}`);
    expect(text).toContain("--no-deps 9router");
  });
});

// ─── Render contracts (`docker compose config`, offline) ────────────────────
// `config` is a client-side render: it reads the files and the project `.env`,
// contacts no registry and needs no engine/daemon. Skips only when the Compose
// CLI is not installed at all.

function composeAvailable() {
  try {
    return spawnSync("docker", ["compose", "version"], { encoding: "utf8", timeout: 20000 }).status === 0;
  } catch {
    return false;
  }
}

const HAS_COMPOSE = composeAvailable();

/**
 * Render one compose file set as JSON. PORT/HEADROOM_PORT are forced to empty
 * so the interpolation falls back to the file's own defaults regardless of the
 * ambient shell environment (an empty value still selects the `:-` default).
 */
function renderConfig(files, extraEnv = {}) {
  const args = [
    "compose",
    ...files.flatMap((file) => ["-f", path.join(REPO_ROOT, file)]),
    "config",
    "--format",
    "json",
  ];
  const res = spawnSync("docker", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 60000,
    env: {
      ...process.env,
      PORT: "",
      HEADROOM_PORT: "",
      NINEROUTER_LOCAL_IMAGE: "",
      ...extraEnv,
    },
  });
  expect(
    res.status,
    `docker compose config failed for [${files.join(", ")}]: ${(res.stderr || "").slice(0, 300)}`
  ).toBe(0);
  try {
    return JSON.parse(res.stdout);
  } catch {
    // Never echo stdout: `config` inlines env_file values, which can be secrets.
    throw new Error(
      `docker compose config did not emit JSON for [${files.join(", ")}] ` +
        `(stderr: ${(res.stderr || "").slice(0, 300)})`
    );
  }
}

function publishedPort(service, target) {
  const entry = (service.ports || []).find((port) => port.target === target);
  return entry ? String(entry.published) : null;
}

describe("docker compose render — default vs local-build fallback", () => {
  it.skipIf(!HAS_COMPOSE)(
    "default render resolves the published images, ports, volume and wiring",
    () => {
      const config = renderConfig([BASE_FILE]);
      const nine = config.services["9router"];
      const headroom = config.services.headroom;

      expect(nine.image).toBe(PUBLISHED_IMAGE);
      expect(headroom.image).toBe(HEADROOM_IMAGE);
      // No build in the default path: `docker compose up -d` pulls, as before.
      expect(nine.build).toBeUndefined();

      expect(nine.container_name).toBe("9router");
      expect(publishedPort(nine, 20128)).toBe("20128");
      expect(publishedPort(headroom, 8787)).toBe("8787");

      const dataVolume = (nine.volumes || []).find((vol) => vol.target === "/app/data");
      expect(dataVolume && dataVolume.source).toBe("9router-data");

      for (const [key, value] of [
        ["DATA_DIR", "/app/data"],
        ["PORT", "20128"],
        ["HOSTNAME", "0.0.0.0"],
        ["NODE_ENV", "production"],
        ["HEADROOM_URL", "http://headroom:8787"],
      ]) {
        expect(nine.environment[key]).toBe(value);
      }
      expect(nine.depends_on.headroom.condition).toBe("service_started");
      // QA-9ROUTER-32: no pinned global name — compose derives the real
      // volume name from the project (basename of the project directory,
      // lowercased per the Compose project-name normalization rules —
      // checkouts like worktrees with uppercase dir names still match).
      expect(config.volumes["9router-data"].name).toBe(
        `${path.basename(REPO_ROOT).toLowerCase()}_9router-data`
      );
    }
  );

  it.skipIf(!HAS_COMPOSE)("default render honours PORT and HEADROOM_PORT overrides", () => {
    const config = renderConfig([BASE_FILE], { PORT: "30128", HEADROOM_PORT: "18787" });
    expect(publishedPort(config.services["9router"], 20128)).toBe("30128");
    expect(publishedPort(config.services.headroom, 8787)).toBe("18787");
  });

  it.skipIf(!HAS_COMPOSE)(
    "fallback render builds the repo Dockerfile locally and keeps every base field",
    () => {
      const config = renderConfig([BASE_FILE, OVERRIDE_FILE]);
      const nine = config.services["9router"];
      const defaults = renderConfig([BASE_FILE]).services["9router"];

      // The local build replaces only the image reference.
      expect(nine.image).toBe(LOCAL_IMAGE_TAG);
      expect(nine.build.context).toBe(REPO_ROOT);
      expect(nine.build.dockerfile).toBe(DOCKERFILE);
      expect(fs.existsSync(path.join(nine.build.context, nine.build.dockerfile))).toBe(true);

      // Everything else is merged in from the base file, unchanged.
      expect(nine.container_name).toBe(defaults.container_name);
      expect(nine.restart).toBe(defaults.restart);
      expect(publishedPort(nine, 20128)).toBe("20128");
      expect((nine.volumes || []).find((vol) => vol.target === "/app/data").source).toBe(
        "9router-data"
      );
      expect(nine.depends_on.headroom.condition).toBe("service_started");
      for (const key of ["DATA_DIR", "PORT", "HOSTNAME", "NODE_ENV", "HEADROOM_URL"]) {
        expect(nine.environment[key]).toBe(defaults.environment[key]);
      }

      // The headroom sidecar stays exactly as published (no invented build).
      expect(config.services.headroom.image).toBe(HEADROOM_IMAGE);
      expect(config.services.headroom.build).toBeUndefined();
      expect(publishedPort(config.services.headroom, 8787)).toBe("8787");
    }
  );

  it.skipIf(!HAS_COMPOSE)("fallback render honours PORT/HEADROOM_PORT and the local tag", () => {
    const config = renderConfig([BASE_FILE, OVERRIDE_FILE], {
      PORT: "30128",
      HEADROOM_PORT: "18787",
      NINEROUTER_LOCAL_IMAGE: "my/9router:dev",
    });
    expect(config.services["9router"].image).toBe("my/9router:dev");
    expect(publishedPort(config.services["9router"], 20128)).toBe("30128");
    expect(publishedPort(config.services.headroom, 8787)).toBe("18787");
  });
});
