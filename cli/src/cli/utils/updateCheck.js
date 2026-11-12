const https = require("https");

function compareVersions(a, b) {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (partsA[i] > partsB[i]) return 1;
    if (partsA[i] < partsB[i]) return -1;
  }
  return 0;
}

function createUpdateOffer(pkg, latestVersion) {
  if (!latestVersion || compareVersions(latestVersion, pkg.version) <= 0) return null;

  const installCommand = `npm i -g ${pkg.name}@latest --prefer-online`;
  if (pkg.federationFork) {
    return {
      kind: "upstream-replaces-fork",
      latestVersion,
      installCommand,
      label: `Install upstream v${latestVersion} (removes federation)`,
    };
  }

  return {
    kind: "update",
    latestVersion,
    installCommand,
    label: `Update to v${latestVersion} (current: v${pkg.version})`,
  };
}

function checkForUpdate({ pkg, skipUpdate, createSpinner, httpsGet = https.get }) {
  return new Promise((resolve) => {
    if (skipUpdate) {
      resolve(null);
      return;
    }

    const spinner = createSpinner("Checking for updates...").start();
    let resolved = false;

    const safetyTimeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        spinner.stop();
        resolve(null);
      }
    }, 8000);

    const done = (version) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(safetyTimeout);
      spinner.stop();
      resolve(createUpdateOffer(pkg, version));
    };

    const req = httpsGet(`https://registry.npmjs.org/${pkg.name}/latest`, { timeout: 3000 }, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try {
          done(JSON.parse(data).version || null);
        } catch {
          done(null);
        }
      });
    });

    req.on("error", () => done(null));
    req.on("timeout", () => { req.destroy(); done(null); });
  });
}

module.exports = {
  checkForUpdate,
  compareVersions,
  createUpdateOffer,
};
