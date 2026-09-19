const { spawn } = require("child_process");
const path = require("path");
const readline = require("readline");
const fs = require("fs");

const scriptPath = path.join(process.env.APPDATA, "npm/node_modules/9router/src/cli/tray/tray.ps1");
const iconPath = path.join(process.env.APPDATA, "npm/node_modules/9router/src/cli/tray/icon.ico");
console.log("script exists", fs.existsSync(scriptPath), "icon", fs.existsSync(iconPath));
console.log("has dump", fs.readFileSync(scriptPath, "utf8").includes("dump-items"));

const ps = spawn("powershell.exe", [
  "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden",
  "-InputFormat", "Text", "-OutputFormat", "Text",
  "-File", scriptPath, "-IconPath", iconPath, "-Tooltip", "probe"
], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });

const send = (cmd) => {
  const line = JSON.stringify(cmd) + "\n";
  console.log(">>", line.trim());
  ps.stdin.write(line, "utf8");
};

readline.createInterface({ input: ps.stdout }).on("line", (line) => {
  console.log("<<", line);
});
ps.stderr.on("data", (d) => console.log("ERR", d.toString()));
ps.on("exit", (c) => console.log("exit", c));

setTimeout(() => {
  send({ action: "add-item", index: 0, title: "A", enabled: false });
  send({ action: "add-item", index: 1, title: "B", enabled: true });
  send({ action: "add-item", index: 2, title: "C", enabled: true });
  send({ action: "add-item", index: 3, title: "✓ RTK Enabled", enabled: true });
  send({ action: "add-item", index: 4, title: "Q", enabled: true });
}, 500);

setTimeout(() => {
  send({ action: "update-item", index: 3, title: "Enable RTK", enabled: true });
  send({ action: "dump-items" });
}, 1200);

setTimeout(() => send({ action: "kill" }), 2500);
setTimeout(() => process.exit(0), 3500);
