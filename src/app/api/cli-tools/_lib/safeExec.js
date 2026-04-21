import fs from "fs";
import os from "os";
import path from "path";

export const getSafeExecCwd = () => {
  const homeDir = os.homedir();
  if (homeDir && fs.existsSync(homeDir)) {
    return homeDir;
  }

  if (os.platform() === "win32") {
    const execRoot = path.parse(process.execPath).root;
    if (execRoot && fs.existsSync(execRoot)) {
      return execRoot;
    }

    const systemDriveRoot = process.env.SystemDrive ? `${process.env.SystemDrive}\\` : "C:\\";
    if (fs.existsSync(systemDriveRoot)) {
      return systemDriveRoot;
    }

    return "C:\\";
  }

  return "/";
};
