function isWindowsReplaceError(error, platform) {
  return platform === "win32" && ["EEXIST", "EPERM", "EACCES"].includes(error?.code);
}

export async function writeJsonFileAtomically(fsApi, filePath, data, options = {}) {
  const platform = options.platform || (typeof process !== "undefined" ? process.platform : undefined);
  const pid = options.pid || (typeof process !== "undefined" ? process.pid : "pid");
  const now = options.now || Date.now;
  const random = options.random || Math.random;
  const suffix = `${pid}.${now()}.${random().toString(36).slice(2)}`;
  const tempPath = `${filePath}.${suffix}.tmp`;
  const backupPath = `${filePath}.${suffix}.bak`;

  try {
    await fsApi.writeFile(tempPath, JSON.stringify(data, null, 2));
    await renameReplacingFile(fsApi, tempPath, filePath, backupPath, platform);
  } catch (error) {
    if (fsApi.rm) {
      await fsApi.rm(tempPath, { force: true }).catch(() => {});
      await fsApi.rm(backupPath, { force: true }).catch(() => {});
    }
    throw error;
  }
}

async function renameReplacingFile(fsApi, tempPath, filePath, backupPath, platform) {
  try {
    await fsApi.rename(tempPath, filePath);
    return;
  } catch (error) {
    if (!isWindowsReplaceError(error, platform)) throw error;
  }

  let hasBackup = false;
  try {
    await fsApi.rename(filePath, backupPath);
    hasBackup = true;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  try {
    await fsApi.rename(tempPath, filePath);
  } catch (error) {
    if (hasBackup) await fsApi.rename(backupPath, filePath).catch(() => {});
    throw error;
  } finally {
    if (hasBackup && fsApi.rm) await fsApi.rm(backupPath, { force: true }).catch(() => {});
  }
}
