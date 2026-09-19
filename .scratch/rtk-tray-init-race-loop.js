/**
 * Feedback loop (post-fix): init must await settings before buildMenuItems.
 * GREEN when label matches settings.rtkEnabled=false.
 */
const path = require("path");
const api = require(path.join(__dirname, "../cli/src/cli/api/client.js"));
const {
  buildMenuItems,
  MENU_INDEX,
  getRtkEnabled
} = require(path.join(__dirname, "../cli/src/cli/tray/tray.js"));

api.configure({ host: "127.0.0.1", port: 20128 });

async function main() {
  const off = await api.updateSettings({ rtkEnabled: false });
  if (!off.success) {
    console.error("setup PATCH failed", off.error);
    process.exit(2);
  }

  // Fixed path (same as initWindowsTray)
  const rtkEnabled = await getRtkEnabled();
  const items = buildMenuItems(20128, true, rtkEnabled);
  const label = items[MENU_INDEX.RTK].title;

  console.log(JSON.stringify({ rtkEnabled, label }, null, 2));

  if (rtkEnabled !== false || label !== "Enable RTK") {
    console.error("RED: tray init label still out of sync with settings");
    process.exit(1);
  }

  console.log("GREEN: init builds Enable RTK when settings are OFF");
  process.exit(0);
}

main();
