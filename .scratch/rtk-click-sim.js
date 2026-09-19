/**
 * End-to-end: toggle via API, then ask tray helpers what label should be.
 * Also writes a forced "tray click simulation" through getRtkEnabled+toggleRtkEnabled.
 */
const path = require("path");
const fs = require("fs");
const api = require(path.join(__dirname, "../cli/src/cli/api/client.js"));
const trayPath = path.join(
  process.env.APPDATA,
  "npm/node_modules/9router/src/cli/tray/tray.js"
);
// Prefer global installed tray (what the running process uses)
const tray = require(fs.existsSync(trayPath) ? trayPath : path.join(__dirname, "../cli/src/cli/tray/tray.js"));

api.configure({ host: "127.0.0.1", port: 20128 });

(async () => {
  // Simulate tray click path twice
  for (let i = 0; i < 2; i++) {
    const before = await api.getSettings();
    const beforeOn = before.data?.rtkEnabled !== false;
    const fromHelper = await tray.getRtkEnabled();
    console.log(`round ${i}: settings=${beforeOn} helper=${fromHelper}`);

    // Direct toggle like handleClick
    const next = !fromHelper;
    const patch = await api.updateSettings({ rtkEnabled: next });
    const afterHelper = await tray.getRtkEnabled();
    console.log(`  patched→${next} success=${patch.success} helperNow=${afterHelper} label=${tray.rtkMenuTitle(afterHelper)}`);

    if (!patch.success || afterHelper !== next) {
      console.error("RED: click simulation failed");
      process.exit(1);
    }
  }
  console.log("GREEN: tray helper toggle path works against live server");
})();
