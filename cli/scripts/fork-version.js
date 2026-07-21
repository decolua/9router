const semver = require("semver");

function upstreamBaseVersion(version) {
  const normalized = semver.valid(version);
  if (!normalized) throw new Error(`Invalid upstream SemVer: ${version}`);
  const parsed = semver.parse(normalized);
  return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
}

function createForkVersion(upstreamVersion, build = "0") {
  const candidate = `${upstreamBaseVersion(upstreamVersion)}-fork.${String(build).trim()}`;
  const normalized = semver.valid(candidate);
  if (!normalized) throw new Error(`Invalid fork SemVer: ${candidate}`);
  return normalized;
}

function resolveForkVersion(upstreamVersion, env = process.env) {
  if (!env.NINEROUTER_FORK_VERSION) {
    return createForkVersion(
      upstreamVersion,
      env.NINEROUTER_FORK_BUILD || env.GITHUB_RUN_NUMBER || "0"
    );
  }

  const explicit = semver.valid(env.NINEROUTER_FORK_VERSION);
  if (!explicit || !explicit.startsWith(`${upstreamBaseVersion(upstreamVersion)}-fork.`)) {
    throw new Error(
      `NINEROUTER_FORK_VERSION must match ${upstreamBaseVersion(upstreamVersion)}-fork.<build>`
    );
  }
  return explicit;
}

module.exports = { createForkVersion, resolveForkVersion, upstreamBaseVersion };
