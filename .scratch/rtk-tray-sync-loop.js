/**
 * Feedback loop: tray RTK label must match GET /api/settings rtkEnabled.
 * Goes RED when tray would show ON while settings say OFF (user symptom).
 */
const { createRequire } = require("module");
const path = require("path");

// Load tray helpers from repo (same logic the tray uses)
const tray = require(path.join(__dirname, "../cli/src/cli/tray/tray.js"));

async function main() {
  const api = require(path.join(__dirname, "../cli/src/cli/api/client.js"));
  api.configure({ host: "127.0.0.1", port: 20128 });

  const getRes = await api.getSettings();
  if (!getRes.success) {
    console.error("FAIL: getSettings failed:", getRes.error);
    process.exit(2);
  }

  const settingsOn = getRes.data?.rtkEnabled !== false;
  // What tray refreshRtkMenuLabel / getRtkEnabled would decide
  const trayWouldShowOn = await (async () => {
    // Inline same logic as getRtkEnabled in tray.js
    try {
      const res = await api.getSettings();
      if (res?.success) return res.data?.rtkEnabled !== false;
    } catch {}
    return true; // default ON — this default is a prime suspect when API fails
  })();

  const label = tray.rtkMenuTitle(trayWouldShowOn);
  console.log(JSON.stringify({
    settingsRtkRaw: getRes.data?.rtkEnabled,
    settingsOn,
    trayWouldShowOn,
    trayLabel: label,
    keysSample: Object.keys(getRes.data || {}).filter((k) => /rtk|caveman|headroom|pony/i.test(k))
  }, null, 2));

  // User symptom: dashboard OFF but tray shows Enabled
  const dashboardOff = getRes.data?.rtkEnabled === false;
  const trayShowsEnabled = label === "✓ RTK Enabled";

  if (dashboardOff && trayShowsEnabled) {
    console.error("RED: dashboard RTK OFF but tray would show ✓ RTK Enabled");
    process.exit(1);
  }

  if (settingsOn !== trayWouldShowOn) {
    console.error("RED: settingsOn !== trayWouldShowOn");
    process.exit(1);
  }

  // Round-trip toggle: set false, read back, set true, read back
  for (const want of [false, true]) {
    const patch = await api.updateSettings({ rtkEnabled: want });
    if (!patch.success) {
      console.error("RED: updateSettings failed:", patch.error);
      process.exit(1);
    }
    const again = await api.getSettings();
    const got = again.data?.rtkEnabled !== false;
    const title = tray.rtkMenuTitle(got);
    const expectTitle = tray.rtkMenuTitle(want);
    if (got !== want || title !== expectTitle) {
      console.error("RED: after PATCH rtkEnabled=" + want, { got, title, expectTitle, raw: again.data?.rtkEnabled });
      process.exit(1);
    }
  }

  console.log("GREEN: tray label logic matches settings API");
  process.exit(0);
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(2);
});
