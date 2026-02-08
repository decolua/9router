const { exec, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const TARGET_HOST = "daily-cloudcode-pa.googleapis.com";
const IS_WIN = process.platform === "win32";
const HOSTS_FILE = IS_WIN
  ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "drivers", "etc", "hosts")
  : "/etc/hosts";

/**
 * Execute command with sudo password via stdin (macOS/Linux only)
 */
function execWithPassword(command, password) {
  return new Promise((resolve, reject) => {
    const child = spawn("sudo", ["-S", "sh", "-c", command], {
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });

    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `Exit code ${code}`));
    });

    child.stdin.write(`${password}\n`);
    child.stdin.end();
  });
}

/**
 * Execute elevated command on Windows via PowerShell RunAs
 */
function execElevatedWindows(command) {
  return new Promise((resolve, reject) => {
    const psCommand = `Start-Process cmd -ArgumentList '/c','${command.replace(/'/g, "''")}' -Verb RunAs -Wait`;
    exec(`powershell -Command "${psCommand}"`, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`Elevated command failed: ${error.message}\n${stderr}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

/**
 * Check if DNS entry already exists
 */
function checkDNSEntry() {
  try {
    const hostsContent = fs.readFileSync(HOSTS_FILE, "utf8");
    return hostsContent.includes(TARGET_HOST);
  } catch {
    return false;
  }
}

/**
 * Add DNS entry to hosts file
 */
async function addDNSEntry(sudoPassword) {
  if (checkDNSEntry()) {
    console.log(`DNS entry for ${TARGET_HOST} already exists`);
    return;
  }

  const entry = `127.0.0.1 ${TARGET_HOST}`;

  try {
    if (IS_WIN) {
      // Windows: use elevated echo >> hosts
      await execElevatedWindows(`echo ${entry} >> "${HOSTS_FILE}"`);
    } else {
      await execWithPassword(`echo "${entry}" >> ${HOSTS_FILE}`, sudoPassword);
    }
    // Flush DNS cache
    if (IS_WIN) {
      await execElevatedWindows("ipconfig /flushdns");
    } else {
      await execWithPassword("dscacheutil -flushcache && killall -HUP mDNSResponder", sudoPassword);
    }
    console.log(`✅ Added DNS entry: ${entry}`);
  } catch (error) {
    const msg = error.message?.includes("incorrect password") ? "Wrong sudo password" : "Failed to add DNS entry";
    throw new Error(msg);
  }
}

/**
 * Remove DNS entry from hosts file
 */
async function removeDNSEntry(sudoPassword) {
  if (!checkDNSEntry()) {
    console.log(`DNS entry for ${TARGET_HOST} does not exist`);
    return;
  }

  try {
    if (IS_WIN) {
      // Windows: read, filter, write back via elevated PowerShell
      const psScript = `(Get-Content '${HOSTS_FILE}') | Where-Object { $_ -notmatch '${TARGET_HOST}' } | Set-Content '${HOSTS_FILE}'`;
      const psCommand = `Start-Process powershell -ArgumentList '-Command','${psScript.replace(/'/g, "''")}' -Verb RunAs -Wait`;
      await new Promise((resolve, reject) => {
        exec(`powershell -Command "${psCommand}"`, (error) => {
          if (error) reject(new Error(`Failed to remove DNS entry: ${error.message}`));
          else resolve();
        });
      });
    } else {
      await execWithPassword(`sed -i '' '/${TARGET_HOST}/d' ${HOSTS_FILE}`, sudoPassword);
    }
    // Flush DNS cache
    if (IS_WIN) {
      await execElevatedWindows("ipconfig /flushdns");
    } else {
      await execWithPassword("dscacheutil -flushcache && killall -HUP mDNSResponder", sudoPassword);
    }
    console.log(`✅ Removed DNS entry for ${TARGET_HOST}`);
  } catch (error) {
    const msg = error.message?.includes("incorrect password") ? "Wrong sudo password" : "Failed to remove DNS entry";
    throw new Error(msg);
  }
}

module.exports = { addDNSEntry, removeDNSEntry, execWithPassword, checkDNSEntry };
