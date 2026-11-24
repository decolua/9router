#!/usr/bin/env node
// Release preparation: syncs root/CLI versions, commits only the manifests, and
// creates the v<version> tag. It never pushes; Docker publishing is tag-triggered.
const { spawnSync } = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")

const ROOT = path.resolve(__dirname, "..")
const MANIFESTS = ["package.json", "cli/package.json"]
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

function fail(message) {
  console.error(`error: ${message}`)
  process.exit(1)
}

function git(args, options = {}) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", ...options })
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim()
    throw new Error(`git ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`)
  }
  return String(result.stdout).trim()
}

function gitQuiet(args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" })
  return result.status === 0 ? String(result.stdout).trim() : null
}

function readVersion(file) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8")).version
}

function writeVersion(file, version) {
  const target = path.join(ROOT, file)
  const manifest = JSON.parse(fs.readFileSync(target, "utf8"))
  manifest.version = version
  fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`)
}

function normalizeVersion(raw) {
  const input = String(raw ?? "").trim()
  if (!input) fail("a version is required, for example: bun run release -- 0.5.120")
  const candidate = input.startsWith("v") ? input.slice(1) : input
  if (candidate.includes("+")) fail(`build metadata is not a Docker-safe tag: ${input}`)
  const match = SEMVER.exec(candidate)
  if (!match) fail(`invalid Docker-safe semver: ${input} (expected X.Y.Z or X.Y.Z-prerelease)`)
  if (candidate.length > 128) fail(`version exceeds the 128-character Docker tag limit: ${candidate}`)
  for (const identifier of (match[4] || "").split(".").filter(Boolean)) {
    if (/^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith("0")) {
      fail(`numeric prerelease identifiers cannot have leading zeroes: ${identifier}`)
    }
  }
  return candidate
}

function trackedChanges() {
  return git(["status", "--porcelain", "--untracked-files=no"])
}

function requireCleanTree() {
  const dirty = trackedChanges()
  if (dirty) fail(`working tree has uncommitted tracked changes:\n${dirty}`)
}

function tagCommit(tag) {
  return gitQuiet(["rev-parse", "--verify", `refs/tags/${tag}^{commit}`])
}

function requireUnusedTag(tag, version) {
  if (tagCommit(tag)) {
    fail(
      `tag ${tag} already exists; choose an unused version (next patch) instead: ` +
        `this script never moves tags. Inspect with: git tag --list 'v${version.split(".")[0]}.*'`,
    )
  }
}

function currentBranch() {
  const branch = gitQuiet(["symbolic-ref", "--short", "HEAD"])
  if (!branch) fail("HEAD is detached; check out the release branch before preparing a release")
  return branch
}

function check() {
  const errors = []
  const [rootFile, cliFile] = MANIFESTS
  const rootVersion = readVersion(rootFile)
  const cliVersion = readVersion(cliFile)

  if (rootVersion !== cliVersion) {
    errors.push(`version mismatch: ${rootFile} is ${rootVersion} but ${cliFile} is ${cliVersion}`)
  }

  const version = normalizeVersion(cliVersion)
  if (version !== cliVersion) fail("manifest versions must not include the v prefix")
  const tag = `v${version}`
  const target = tagCommit(tag)
  if (!target) {
    errors.push(`missing tag ${tag}; run: bun run release -- ${version}`)
  } else if (target !== git(["rev-parse", "HEAD"])) {
    errors.push(`tag ${tag} points at ${target}, not HEAD (${git(["rev-parse", "HEAD"])})`)
  }
  if (target && rootVersion !== version) errors.push(`tag ${tag} does not match ${rootFile} version ${rootVersion}`)

  const dirty = git(["status", "--porcelain", "--untracked-files=no", "--", ...MANIFESTS])
  if (dirty) errors.push(`release manifests have uncommitted changes:\n${dirty}`)

  if (errors.length) fail(`release check failed:\n- ${errors.join("\n- ")}`)
  console.log(`Release ${tag} is ready at ${target}.`)
}

function prepare(args) {
  const version = normalizeVersion(args[0])
  const tag = `v${version}`

  requireCleanTree()
  requireUnusedTag(tag, version)
  const branch = currentBranch()

  const changed = MANIFESTS.filter((file) => readVersion(file) !== version)
  for (const file of changed) writeVersion(file, version)

  if (changed.length) {
    git(["commit", "-q", "-m", `chore(release): ${tag}`, "--", ...changed])
    console.log(`Committed ${tag} manifest sync (${changed.join(", ")}).`)
  } else {
    console.log(`Manifests already at ${version}; nothing to commit.`)
  }

  requireCleanTree()
  git(["tag", tag, "HEAD"])

  console.log(`\nTag ${tag} created at HEAD on ${branch}. Nothing was pushed; not pushed automatically.`)
  console.log("Publish atomically (the tag push triggers the Docker workflow):")
  console.log(`  git push --atomic origin ${branch} refs/tags/${tag}`)
  console.log("Verify before pushing with: bun run release -- --check")
}

function usage() {
  console.log(`Usage: bun run release -- [version]
       bun run release -- --check

  version   Docker-safe semver (X.Y.Z or X.Y.Z-prerelease); defaults to cli/package.json.
  --check   Read-only: both manifests match, tag v<version> exists at HEAD, manifests committed.`)
}

function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) return usage()
  const checkOnly = argv.includes("--check")
  const args = argv.filter((arg) => arg !== "--check")
  if (args.some((arg) => arg.startsWith("-"))) fail(`unknown option: ${args.find((arg) => arg.startsWith("-"))}`)
  if (checkOnly && args.length) fail("--check is read-only and does not take a version argument")
  if (args.length > 1) fail(`expected at most one version argument, received: ${args.join(" ")}`)
  if (checkOnly) return check()
  return prepare(args.length ? args : [readVersion("cli/package.json")])
}

main(process.argv.slice(2))
