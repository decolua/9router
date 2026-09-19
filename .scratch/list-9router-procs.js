const { execSync } = require("child_process");
const out = execSync('powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'node.exe\'\\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Depth 2"', { encoding: "utf8" });
const rows = JSON.parse(out || "[]");
const list = Array.isArray(rows) ? rows : [rows];
for (const r of list) {
  const cmd = r.CommandLine || "";
  if (/9router/i.test(cmd)) console.log(r.ProcessId, cmd.slice(0, 200));
}
