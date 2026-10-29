/**
 * QA-9ROUTER-23 — the production image was built OUTSIDE the tracked lockfile,
 * through a hardcoded third-party CN mirror.
 *
 * The root Dockerfile copied only `package.json` and ran
 * `npm install --registry=https://registry.npmmirror.com`, while the repo
 * tracks a `package-lock.json` whose name/version match `package.json`. Two
 * independent defects follow from that single instruction pair:
 *
 *   1. NON-REPRODUCIBLE RESOLUTION — `npm install` re-resolves the semver
 *      ranges in package.json, so the same commit can produce different
 *      dependency trees in different builds (and silently drifts from the
 *      lockfile the rest of the project is verified against). `npm ci` installs
 *      exactly the lockfile and hard-fails when manifest and lockfile disagree.
 *   2. MIRROR DEPENDENCE — the install (and an `apk` repository rewrite in the
 *      `base` stage, replacing dl-cdn.alpinelinux.org with mirrors.aliyun.com)
 *      made success a function of a third-party mirror's reachability and
 *      latency. Clean-machine measurement on the QA agent: the build passed,
 *      but the mirrored apk step alone cost ~237 seconds.
 *
 * This is a STATIC contract test: it asserts the Dockerfile text and the
 * manifest/lockfile pair. It deliberately does NOT shell out to `docker build`
 * — a live image build is minutes long, network-dependent and exactly the
 * non-determinism this task removed, so it is not a gate. Every assertion below
 * is offline and order-sensitive where order matters (a lockfile copied after
 * the install, or a `COPY . ./` before it, would defeat the fix).
 *
 * Coverage:
 *   - builder stage: manifest AND lockfile copied BEFORE the dependency install
 *   - that install is `npm ci`, with no `npm install` fallback and no flags that
 *     weaken it (registry override, --ignore-scripts, dev-dependency omission)
 *   - the install (and the whole manifest copy) precede `COPY . ./`, so the
 *     resolved tree depends only on the lockfile
 *   - no CN mirror anywhere: no npmmirror.com, no mirrors.aliyun.com, no
 *     /etc/apk/repositories rewrite, no `--registry=` override at all
 *   - the rest of the image contract is intact: the three stages, the Alpine
 *     build deps, every builder→runner COPY (federation runtime modules, MITM,
 *     sql.js/node-forge/node-machine-id/next), env, EXPOSE, ENTRYPOINT, CMD
 *   - package.json/package-lock.json agree (name, version) — the precondition
 *     `npm ci` enforces at build time
 */

import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DOCKERFILE_PATH = path.join(REPO_ROOT, "Dockerfile");

const dockerfile = fs.readFileSync(DOCKERFILE_PATH, "utf8");

/** Non-comment, non-blank instruction lines, in file order. */
function instructionLines(text) {
  return text
    .split("\n")
    .map((raw) => raw.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

const INSTRUCTIONS = instructionLines(dockerfile);

/** Parse `FROM <base> [AS <name>]` sections into {base, name, lines}. */
function parseStages(text) {
  const stages = [];
  let current = null;
  for (const line of instructionLines(text)) {
    const from = /^FROM\s+(\S+)(?:\s+AS\s+(\S+))?$/i.exec(line);
    if (from) {
      current = {
        base: from[1].toLowerCase(),
        name: (from[2] || `stage${stages.length}`).toLowerCase(),
        lines: [],
      };
      stages.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }
  return stages;
}

const STAGES = parseStages(dockerfile);
const stageByName = (name) => STAGES.find((stage) => stage.name === name);
const builder = stageByName("builder");
const runner = stageByName("runner");
const builderText = builder ? builder.lines.join("\n") : "";
const runnerText = runner ? runner.lines.join("\n") : "";

/** Index of the first instruction line satisfying `predicate`, or -1. */
function firstIndex(predicate) {
  return INSTRUCTIONS.findIndex(predicate);
}

const manifestCopyIndex = firstIndex(
  (line) => /^COPY\s/.test(line) && /\bpackage\.json\b/.test(line),
);
const lockfileCopyIndex = firstIndex(
  (line) => /^COPY\s/.test(line) && /\bpackage-lock\.json\b/.test(line),
);
const sourceCopyIndex = firstIndex((line) => /^COPY\s+\.\s+\.\/?$/.test(line));
const buildIndex = firstIndex((line) => /^RUN\s+.*npm\s+run\s+build\b/.test(line));

/** Every RUN line that invokes npm's dependency installer (ci / install / i). */
const installCommands = INSTRUCTIONS.filter(
  (line) => /^RUN\s/.test(line) && /\bnpm\s+(ci|install|i)\b/.test(line),
);

/** `COPY --from=builder <src> <dest>` pairs in the runner stage.
 * QA-9ROUTER-33: flags are allowed before --from=builder (the runner now
 * carries --chown=node:node on every copy); the src->dest pair is still
 * the last two tokens. */
function builderCopies(text) {
  return instructionLines(text)
    .map((line) =>
      /^COPY\s+(?:(?:--[\w-]+(?:=\S+)?\s+)+)?--from=builder\s+(?:(?:--[\w-]+(?:=\S+)?\s+)*)(\S+)\s+(\S+)$/.exec(
        line,
      ),
    )
    .filter(Boolean)
    .map((match) => `${match[1]} -> ${match[2]}`);
}

const RUNNER_COPIES = builderCopies(runnerText);

describe("root Dockerfile — reproducible, mirror-free dependency install", () => {
  it("parses the expected three-stage image (guards the assertions below from a vacuous parse)", () => {
    expect(STAGES.map((stage) => stage.name)).toEqual(["base", "builder", "runner"]);
    expect(builder.base).toBe("base");
    expect(runner.base).toBe("${node_image}");
    expect(installCommands.length).toBe(1);
    expect(RUNNER_COPIES.length).toBeGreaterThanOrEqual(13);
  });

  it("copies package.json AND package-lock.json before installing dependencies", () => {
    expect(manifestCopyIndex).toBeGreaterThanOrEqual(0);
    expect(lockfileCopyIndex).toBeGreaterThanOrEqual(0);
    // The lockfile must reach the builder stage, not merely exist in the repo.
    expect(builderText).toMatch(/\bpackage-lock\.json\b/);
    expect(lockfileCopyIndex).toBeLessThan(buildIndex);
    // Both manifests are copied, and the install is scoped to them.
    expect(INSTRUCTIONS[manifestCopyIndex]).toBe(INSTRUCTIONS[lockfileCopyIndex]);
    expect(INSTRUCTIONS[manifestCopyIndex]).toBe("COPY package.json package-lock.json ./");
  });

  it("installs with `npm ci` — no `npm install`, no weakening flags", () => {
    const [install] = installCommands;
    expect(install).toBeDefined();
    expect(install).toMatch(/\bnpm ci(\s|$)/);
    expect(install).not.toMatch(/\bnpm install\b/);
    // A registry override re-introduces mirror dependence; dropping dev
    // dependencies or install scripts breaks `npm run build` / native modules.
    for (const forbidden of [
      "--registry",
      "--ignore-scripts",
      "--omit=dev",
      "--production",
      "--no-package-lock",
      "--force",
    ]) {
      expect(install).not.toContain(forbidden);
    }
    // No second, competing install anywhere in the image.
    expect(installCommands).toHaveLength(1);
    expect(runnerText).not.toMatch(/\bnpm\s+(ci|install|i)\b/);
  });

  it("installs from the manifest pair BEFORE copying the source tree", () => {
    expect(manifestCopyIndex).toBeLessThan(sourceCopyIndex);
    expect(lockfileCopyIndex).toBeLessThan(sourceCopyIndex);
    expect(sourceCopyIndex).toBeLessThan(buildIndex);
  });

  it("has no CN mirror references and rewrites no apk repositories", () => {
    const lower = dockerfile.toLowerCase();
    expect(lower).not.toContain("npmmirror.com");
    expect(lower).not.toContain("mirrors.aliyun.com");
    expect(lower).not.toContain("--registry=");
    // The base stage used to sed dl-cdn.alpinelinux.org -> mirrors.aliyun.com.
    // No apk repository rewrite of any kind belongs in the production path.
    expect(lower).not.toContain("/etc/apk/repositories");
    expect(lower).not.toMatch(/sed\s+-i/);
  });

  it("keeps the Alpine build dependencies and the three-stage structure", () => {
    const apkAdd = INSTRUCTIONS.find(
      (line) => /^RUN\s+apk\s/.test(line) && /\bapk\s+--no-cache\s+add\b/.test(line),
    );
    expect(apkAdd).toBeDefined();
    for (const pkg of ["python3", "make", "g++", "linux-headers"]) {
      expect(apkAdd).toContain(pkg);
    }
    expect(builderText).toContain("apk --no-cache upgrade");
    expect(builderText).toContain("NEXT_TELEMETRY_DISABLED=1");
  });

  it("keeps every builder→runner copy the image depends on (full src surface, MITM, drivers)", () => {
    const required = [
      "/app/public -> ./public",
      "/app/.next/static -> ./.next/static",
      "/app/.next/standalone -> ./",
      "/app/custom-server.js -> ./custom-server.js",
      "/app/open-sse -> ./open-sse",
      // QA-9ROUTER-32: one full-src copy replaces the fine-grained
      // src/lib/federation + src/lib/db + src/lib/dataDir.mjs + src/mitm
      // copies — custom-server.js dynamically imports more of src/ than
      // standalone tracing ships (src/sse/services/backgroundTokenRefresh.js
      // and its transitive chain), and clean-machine deploys died
      // MODULE_NOT_FOUND at boot without it.
      "/app/src -> ./src",
      "/app/node_modules/node-forge -> ./node_modules/node-forge",
      "/app/node_modules/next -> ./node_modules/next",
      "/app/node_modules/sql.js -> ./node_modules/sql.js",
      "/app/node_modules/node-machine-id -> ./node_modules/node-machine-id",
      // npm deps of the shipped src surface that tracing omits for the same
      // reason (first post-fix boot died on `uuid` from connectionsRepo.js).
      "/app/node_modules/uuid -> ./node_modules/uuid",
      "/app/node_modules/bcryptjs -> ./node_modules/bcryptjs",
      "/app/node_modules/jose -> ./node_modules/jose",
      "/app/node_modules/undici -> ./node_modules/undici",
      "/app/node_modules/ora -> ./node_modules/ora",
      "/app/node_modules/chalk -> ./node_modules/chalk",
    ];
    for (const entry of required) {
      expect(RUNNER_COPIES).toContain(entry);
    }
    // Federation runtime modules ship via the full-src copy above: without
    // them FEDERATION_MODE=edge is silently inert. The bare "open-sse/*"
    // specifier is a build-time alias, so plain Node needs a node_modules
    // link to resolve the backgroundTokenRefresh chain at runtime.
    expect(runnerText).toMatch(/RUN\s+.*ln\s+-s\s+\/app\/open-sse\s+\/app\/node_modules\/open-sse/);
    // QA-9ROUTER-33: ownership is set at COPY time (--chown=node:node on
    // every builder→runner copy) — the old post-hoc `chown -R node:node
    // /app` walked the whole image tree (140.2s) and stalled BuildKit's
    // `exporting to image` with no servable result. The build-time chown
    // is reduced to the runtime-writable paths.
    const runnerBuilderCopies = instructionLines(runnerText).filter(
      (line) => /^COPY\s/.test(line) && line.includes("--from=builder"),
    );
    expect(runnerBuilderCopies.length).toBe(RUNNER_COPIES.length);
    for (const line of runnerBuilderCopies) {
      expect(line).toContain("--chown=node:node");
    }
    expect(runnerText).toMatch(/chown node:node \/app \/app\/data \/app\/data-home/);
    expect(runnerText).not.toMatch(/^RUN\s.*chown\s+-R\s/);
  });

  it("keeps the runtime surface intact (env, port, entrypoint, command, su-exec)", () => {
    for (const envLine of [
      "NODE_ENV=production",
      "PORT=20128",
      "HOSTNAME=0.0.0.0",
      "DATA_DIR=/app/data",
      "NEXT_TELEMETRY_DISABLED=1",
    ]) {
      expect(INSTRUCTIONS).toContain(`ENV ${envLine}`);
    }
    expect(INSTRUCTIONS).toContain("EXPOSE 20128");
    expect(INSTRUCTIONS).toContain('ENTRYPOINT ["/entrypoint.sh"]');
    expect(INSTRUCTIONS).toContain('CMD ["node", "custom-server.js"]');
    expect(runnerText).toContain("su-exec");
    expect(runnerText).toContain("/app/data-home");
  });

  it("keeps package.json and package-lock.json in agreement (the npm ci precondition)", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
    const lock = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package-lock.json"), "utf8"));

    expect(lock.name).toBe(manifest.name);
    expect(lock.version).toBe(manifest.version);
    expect(lock.lockfileVersion).toBeGreaterThanOrEqual(2);
    // `npm ci` installs exactly the root package's declared deps from the lock,
    // so a lock missing them would break the image build.
    const lockedRoot = lock.packages && lock.packages[""];
    expect(lockedRoot).toBeDefined();
    expect(lockedRoot.name).toBe(manifest.name);
    expect(lockedRoot.version).toBe(manifest.version);
  });
});
