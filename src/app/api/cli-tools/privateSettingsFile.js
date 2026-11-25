import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";

// ENOENT can mean either a missing file or a symlink with a missing target.
async function checkMissingFile(file, error) {
  if (error.code !== "ENOENT") throw error;
  const entry = await fs.lstat(file).catch(statError => {
    if (statError.code !== "ENOENT") throw statError;
  });
  if (entry?.isSymbolicLink()) throw new Error("Broken settings symlink: " + file, { cause: error });
}

export async function readOptionalFile(file) {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    await checkMissingFile(file, error);
    return null;
  }
}

// Replacing the inode also tightens permissions on existing files.
export async function writePrivateFile(file, content) {
  const target = await fs.realpath(file).catch(async error => {
    await checkMissingFile(file, error);
    return file;
  });
  const temp = target + "." + randomUUID() + ".tmp";
  const handle = await fs.open(temp, "wx", 0o600);
  try {
    try {
      await handle.writeFile(content);
    } finally {
      await handle.close();
    }
    await fs.rename(temp, target);
  } finally {
    await fs.rm(temp, { force: true });
  }
}
