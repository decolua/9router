// Release preparation regression tests: root/CLI version drift + tagless publication.
// Each case runs the real scripts/release.js inside a disposable git repository.
import { afterEach, describe, expect, it } from "vitest"
import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = fileURLToPath(new URL("../..", import.meta.url))
const releaseScript = path.join(repoRoot, "scripts/release.js")
const roots = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== path.resolve(os.tmpdir())) throw new Error("Unexpected temporary directory")
    fs.rmSync(root, { recursive: true, force: true })
  }
})

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim()
}

function writeManifest(file, version, extra = {}) {
  fs.writeFileSync(file, `${JSON.stringify({ name: path.basename(path.dirname(file)), version, ...extra }, null, 2)}\n`)
}

function makeRepo({ rootVersion = "0.5.116", cliVersion = "0.5.119" } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-release-"))
  roots.push(dir)
  fs.mkdirSync(path.join(dir, "scripts"))
  fs.mkdirSync(path.join(dir, "cli"))
  fs.copyFileSync(releaseScript, path.join(dir, "scripts", "release.js"))
  writeManifest(path.join(dir, "package.json"), rootVersion)
  writeManifest(path.join(dir, "cli", "package.json"), cliVersion)
  fs.writeFileSync(path.join(dir, "README.md"), "# fixture\n")
  git(dir, "init", "-q", "-b", "master")
  git(dir, "config", "user.email", "release-test@example.com")
  git(dir, "config", "user.name", "Release Test")
  git(dir, "config", "commit.gpgsign", "false")
  git(dir, "add", "-A")
  git(dir, "commit", "-q", "-m", "chore: fixture")
  return dir
}

function release(dir, args = [], { cwd } = {}) {
  const result = spawnSync(process.execPath, [path.join(dir, "scripts", "release.js"), ...args], {
    cwd: cwd || dir,
    encoding: "utf8",
    timeout: 20000,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
  })
  return { code: result.status, stdout: result.stdout || "", stderr: result.stderr || "" }
}

function versions(dir) {
  const read = (file) => JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")).version
  return { root: read("package.json"), cli: read("cli/package.json") }
}

function tagTarget(dir, tag) {
  try {
    return git(dir, "rev-parse", `refs/tags/${tag}`)
  } catch {
    return null
  }
}

describe("release script: happy path", () => {
  it("syncs both manifests, commits only them, and tags HEAD without pushing", () => {
    const dir = makeRepo()
    fs.writeFileSync(path.join(dir, "notes.txt"), "untracked\n")
    const originalHead = git(dir, "rev-parse", "HEAD")

    const result = release(dir, ["0.5.120"])

    expect(result.code, result.stderr).toBe(0)
    expect(versions(dir)).toEqual({ root: "0.5.120", cli: "0.5.120" })
    expect(git(dir, "symbolic-ref", "--short", "HEAD")).toBe("master")
    expect(git(dir, "log", "--format=%s", "-1")).toBe("chore(release): v0.5.120")
    expect(git(dir, "show", "--name-only", "--format=", "HEAD").split("\n").sort()).toEqual([
      "cli/package.json",
      "package.json",
    ])
    expect(git(dir, "diff", "--name-only", originalHead, "HEAD").split("\n").sort()).toEqual([
      "cli/package.json",
      "package.json",
    ])
    expect(tagTarget(dir, "v0.5.120")).toBe(git(dir, "rev-parse", "HEAD"))
    expect(fs.existsSync(path.join(dir, "notes.txt"))).toBe(true)
    expect(git(dir, "status", "--porcelain", "notes.txt")).toBe("?? notes.txt")
    expect(result.stdout).toContain("git push")
    expect(result.stdout.toLowerCase()).toContain("not pushed")
  })

  it("defaults to the CLI version when no argument is given", () => {
    const dir = makeRepo()

    const result = release(dir)

    expect(result.code, result.stderr).toBe(0)
    expect(versions(dir)).toEqual({ root: "0.5.119", cli: "0.5.119" })
    expect(tagTarget(dir, "v0.5.119")).toBe(git(dir, "rev-parse", "HEAD"))
  })

  it("is idempotent when manifests already match: no new commit, tag points at HEAD", () => {
    const dir = makeRepo({ rootVersion: "0.5.119", cliVersion: "0.5.119" })
    const before = git(dir, "rev-list", "--count", "HEAD")

    const result = release(dir, ["0.5.119"])

    expect(result.code, result.stderr).toBe(0)
    expect(git(dir, "rev-list", "--count", "HEAD")).toBe(before)
    expect(versions(dir)).toEqual({ root: "0.5.119", cli: "0.5.119" })
    expect(tagTarget(dir, "v0.5.119")).toBe(git(dir, "rev-parse", "HEAD"))
  })

  it("accepts a v-prefixed version argument", () => {
    const dir = makeRepo({ rootVersion: "1.0.0", cliVersion: "1.0.0" })

    const result = release(dir, ["v1.0.1-rc.1"])

    expect(result.code, result.stderr).toBe(0)
    expect(versions(dir)).toEqual({ root: "1.0.1-rc.1", cli: "1.0.1-rc.1" })
    expect(tagTarget(dir, "v1.0.1-rc.1")).toBe(git(dir, "rev-parse", "HEAD"))
  })
})

describe("release script: version validation", () => {
  it.each(["1.2", "1.2.3.4", "01.2.3", "1.02.3", "1.2.3+build.7", "1.2.3-rc.01", "latest", ""])(
    "rejects malformed version %j without touching files or tags",
    (version) => {
      const dir = makeRepo()

      const result = release(dir, [version])

      expect(result.code).not.toBe(0)
      expect(versions(dir)).toEqual({ root: "0.5.116", cli: "0.5.119" })
      expect(git(dir, "tag", "--list")).toBe("")
      expect(git(dir, "status", "--porcelain")).toBe("")
    },
  )

  it("rejects a version that already has a tag before editing manifests", () => {
    const dir = makeRepo()
    const originalHead = git(dir, "rev-parse", "HEAD")
    git(dir, "tag", "v0.5.120", originalHead)
    fs.writeFileSync(path.join(dir, "README.md"), "# fixture v2\n")
    git(dir, "commit", "-qam", "chore: move head")

    const result = release(dir, ["0.5.120"])

    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain("v0.5.120")
    expect(versions(dir)).toEqual({ root: "0.5.116", cli: "0.5.119" })
    expect(tagTarget(dir, "v0.5.120")).toBe(originalHead)
  })

  it("rejects unknown options and extra arguments", () => {
    const dir = makeRepo()

    const unknown = release(dir, ["--bogus"])
    const extra = release(dir, ["0.5.120", "0.5.121"])

    expect(unknown.code).not.toBe(0)
    expect(unknown.stderr).toContain("--bogus")
    expect(extra.code).not.toBe(0)
    expect(versions(dir)).toEqual({ root: "0.5.116", cli: "0.5.119" })
    expect(git(dir, "tag", "--list")).toBe("")
  })

  it("rejects a dirty working tree without editing manifests", () => {
    const dir = makeRepo()
    fs.writeFileSync(path.join(dir, "cli", "package.json"), `${JSON.stringify({ name: "cli", version: "0.5.119", dirty: true })}\n`)

    const result = release(dir, ["0.5.120"])

    expect(result.code).not.toBe(0)
    expect(versions(dir)).toEqual({ root: "0.5.116", cli: "0.5.119" })
    expect(git(dir, "tag", "--list")).toBe("")
    expect(git(dir, "status", "--porcelain", "cli/package.json")).not.toBe("")
  })

  it("rejects detached HEAD before creating a commit or tag", () => {
    const dir = makeRepo()
    const head = git(dir, "rev-parse", "HEAD")
    git(dir, "switch", "--detach", "-q")
    const result = release(dir, ["0.5.120"])
    expect(result.code).not.toBe(0)
    expect(git(dir, "rev-parse", "HEAD")).toBe(head)
    expect(git(dir, "tag", "--list")).toBe("")
    expect(versions(dir)).toEqual({ root: "0.5.116", cli: "0.5.119" })
  })
})

describe("release script: --check", () => {
  it("rejects a tagged version that Docker cannot publish", () => {
    const dir = makeRepo({ rootVersion: "1.2.3+build", cliVersion: "1.2.3+build" })
    git(dir, "tag", "v1.2.3+build")
    expect(release(dir, ["--check"]).code).not.toBe(0)
  })
  it("reports a missing tag", () => {
    const dir = makeRepo({ rootVersion: "0.5.119", cliVersion: "0.5.119" })

    const result = release(dir, ["--check"])

    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain("v0.5.119")
  })

  it("reports a tag that is not at HEAD", () => {
    const dir = makeRepo({ rootVersion: "0.5.119", cliVersion: "0.5.119" })
    git(dir, "tag", "v0.5.119")
    fs.writeFileSync(path.join(dir, "README.md"), "# newer\n")
    git(dir, "commit", "-qam", "chore: newer")

    const result = release(dir, ["--check"])

    expect(result.code).not.toBe(0)
    expect(result.stderr.toLowerCase()).toContain("head")
  })

  it("reports dirty release manifests", () => {
    const dir = makeRepo({ rootVersion: "0.5.119", cliVersion: "0.5.119" })
    git(dir, "tag", "v0.5.119")
    fs.appendFileSync(path.join(dir, "package.json"), "\n")

    const result = release(dir, ["--check"])

    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain("package.json")
  })

  it("reports root/CLI version drift", () => {
    const dir = makeRepo({ rootVersion: "0.5.116", cliVersion: "0.5.119" })
    writeManifest(path.join(dir, "package.json"), "0.5.119")
    git(dir, "commit", "-qam", "chore: align root")
    git(dir, "tag", "v0.5.119")
    writeManifest(path.join(dir, "cli", "package.json"), "0.5.120")
    writeManifest(path.join(dir, "package.json"), "0.5.119")

    const result = release(dir, ["--check"])

    expect(result.code).not.toBe(0)
    expect(result.stderr.toLowerCase()).toContain("mismatch")
  })

  it("passes after a release and blocks publishing before one", () => {
    const dir = makeRepo()
    const cliDir = path.join(dir, "cli")

    const before = release(dir, ["--check"], { cwd: cliDir })
    expect(before.code).not.toBe(0)

    expect(release(dir, ["0.5.120"]).code).toBe(0)

    const after = release(dir, ["--check"], { cwd: cliDir })
    expect(after.code, after.stderr).toBe(0)
    expect(after.stdout).toContain("v0.5.120")
  })
})

describe("release wiring", () => {
  it("exposes the root release alias and runs the publish guard before the build", () => {
    const rootPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"))
    const cliPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "cli", "package.json"), "utf8"))

    expect(rootPkg.scripts.release).toBe("node scripts/release.js")

    const steps = cliPkg.scripts.prepublishOnly.split("&&").map((step) => step.trim())
    expect(steps[0]).toBe("node ../scripts/release.js --check")
    expect(steps.at(-1)).toBe("npm run build")
    expect(cliPkg.scripts["publish:cli"]).toBe("npm publish")
  })

  it("makes the publish guard fail in an unreleased checkout and pass after release", () => {
    const dir = makeRepo()
    const cliDir = path.join(dir, "cli")
    const guard = JSON.parse(fs.readFileSync(path.join(repoRoot, "cli", "package.json"), "utf8")).scripts.prepublishOnly.split("&&")[0].trim()
    const [command, ...commandArgs] = guard.split(" ")

    const blocked = spawnSync(command, commandArgs, { cwd: cliDir, encoding: "utf8", timeout: 20000 })
    expect(blocked.status).not.toBe(0)

    expect(release(dir, ["0.5.120"]).code).toBe(0)

    const allowed = spawnSync(command, commandArgs, { cwd: cliDir, encoding: "utf8", timeout: 20000 })
    expect(allowed.status, allowed.stderr).toBe(0)
  })
})
