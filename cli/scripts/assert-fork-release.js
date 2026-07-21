const path = require("path");
const semver = require("semver");

const pkg = require(path.resolve(__dirname, "..", "package.json"));
const parsed = semver.parse(pkg.version);
const isForkVersion = parsed?.prerelease?.[0] === "fork" && parsed.prerelease.length >= 2;

if (pkg.name !== "@loldlm1/9router" || !isForkVersion) {
  console.error("Refusing publish: expected @loldlm1/9router with <upstream>-fork.<build> version.");
  process.exit(1);
}
