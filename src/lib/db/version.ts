import fs from "node:fs";
import path from "node:path";

let cachedVersion: string | null = null;

export function getAppVersion() {
  if (cachedVersion) return cachedVersion;
  try {
    const pkgPath = path.join(process.cwd(), "package.json");
    const raw: unknown = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const version =
      raw && typeof raw === "object" && "version" in raw && typeof raw["version"] === "string"
        ? raw["version"]
        : "0.0.0";
    cachedVersion = version;
  } catch {
    cachedVersion = "0.0.0";
  }
  return cachedVersion;
}

export function timestampSlug(date: Date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
