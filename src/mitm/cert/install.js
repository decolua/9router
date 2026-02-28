const fs = require("fs");
const crypto = require("crypto");
const { exec } = require("child_process");
const { execWithPassword } = require("../dns/dnsConfig.js");

const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const LINUX_CERT_DIR = "/usr/local/share/ca-certificates";

// Get SHA1 fingerprint from cert file using Node.js crypto
function getCertFingerprint(certPath) {
  const pem = fs.readFileSync(certPath, "utf-8");
  const der = Buffer.from(pem.replace(/-----[^-]+-----/g, "").replace(/\s/g, ""), "base64");
  return crypto.createHash("sha1").update(der).digest("hex").toUpperCase().match(/.{2}/g).join(":");
}

/**
 * Check if certificate is already installed in system store
 */
async function checkCertInstalled(certPath) {
  if (IS_WIN) return checkCertInstalledWindows(certPath);
  if (IS_MAC) return checkCertInstalledMac(certPath);
  return checkCertInstalledLinux();
}

function checkCertInstalledMac(certPath) {
  return new Promise((resolve) => {
    try {
      const fingerprint = getCertFingerprint(certPath);
      exec(`security find-certificate -a -Z /Library/Keychains/System.keychain | grep -i "${fingerprint}"`, (error) => {
        resolve(!error);
      });
    } catch {
      resolve(false);
    }
  });
}

function checkCertInstalledWindows(certPath) {
  return new Promise((resolve) => {
    // Check Root store for our cert by subject name
    exec("certutil -store Root daily-cloudcode-pa.googleapis.com", (error) => {
      resolve(!error);
    });
  });
}

/**
 * Install SSL certificate to system trust store
 */
async function installCert(sudoPassword, certPath) {
  if (!fs.existsSync(certPath)) {
    throw new Error(`Certificate file not found: ${certPath}`);
  }

  const isInstalled = await checkCertInstalled(certPath);
  if (isInstalled) {
    console.log("✅ Certificate already installed");
    return;
  }

  if (IS_WIN) {
    await installCertWindows(certPath);
  } else if (IS_MAC) {
    await installCertMac(sudoPassword, certPath);
  } else {
    await installCertLinux(sudoPassword, certPath);
  }
}

async function installCertMac(sudoPassword, certPath) {
  const command = `security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${certPath}"`;
  try {
    await execWithPassword(command, sudoPassword);
    console.log(`✅ Installed certificate to system keychain: ${certPath}`);
  } catch (error) {
    const msg = error.message?.includes("canceled") ? "User canceled authorization" : "Certificate install failed";
    throw new Error(msg);
  }
}

async function installCertWindows(certPath) {
  const escaped = certPath.replace(/'/g, "''");
  const psCommand = `Start-Process certutil -ArgumentList '-addstore','Root','${escaped}' -Verb RunAs -Wait -WindowStyle Hidden`;
  return new Promise((resolve, reject) => {
    exec(
      `powershell -NonInteractive -WindowStyle Hidden -Command "${psCommand}"`,
      { windowsHide: true },
      (error) => {
        if (error) reject(new Error(`Failed to install certificate: ${error.message}`));
        else { console.log("✅ Installed certificate to Windows Root store"); resolve(); }
      }
    );
  });
}

/**
 * Uninstall SSL certificate from system store
 */
async function uninstallCert(sudoPassword, certPath) {
  const isInstalled = await checkCertInstalled(certPath);
  if (!isInstalled) {
    console.log("Certificate not found in system store");
    return;
  }

  if (IS_WIN) {
    await uninstallCertWindows();
  } else if (IS_MAC) {
    await uninstallCertMac(sudoPassword, certPath);
  } else {
    await uninstallCertLinux(sudoPassword);
  }
}

async function uninstallCertMac(sudoPassword, certPath) {
  const fingerprint = getCertFingerprint(certPath).replace(/:/g, "");
  const command = `security delete-certificate -Z "${fingerprint}" /Library/Keychains/System.keychain`;
  try {
    await execWithPassword(command, sudoPassword);
    console.log("✅ Uninstalled certificate from system keychain");
  } catch (err) {
    throw new Error("Failed to uninstall certificate");
  }
}

async function uninstallCertWindows() {
  const psCommand = `Start-Process certutil -ArgumentList '-delstore','Root','daily-cloudcode-pa.googleapis.com' -Verb RunAs -Wait -WindowStyle Hidden`;
  return new Promise((resolve, reject) => {
    exec(
      `powershell -NonInteractive -WindowStyle Hidden -Command "${psCommand}"`,
      { windowsHide: true },
      (error) => {
        if (error) reject(new Error(`Failed to uninstall certificate: ${error.message}`));
        else { console.log("✅ Uninstalled certificate from Windows Root store"); resolve(); }
      }
    );
  });
}

function checkCertInstalledLinux() {
  const certFile = `${LINUX_CERT_DIR}/9router-mitm.crt`;
  return Promise.resolve(fs.existsSync(certFile));
}

async function installCertLinux(sudoPassword, certPath) {
  const destFile = `${LINUX_CERT_DIR}/9router-mitm.crt`;
  // Try update-ca-certificates (Debian/Ubuntu), fallback to update-ca-trust (Fedora/RHEL)
  const cmd = `cp "${certPath}" "${destFile}" && (update-ca-certificates 2>/dev/null || update-ca-trust 2>/dev/null || true)`;
  try {
    await execWithPassword(cmd, sudoPassword);
    console.log("✅ Installed certificate to Linux trust store");
  } catch (error) {
    throw new Error("Certificate install failed");
  }
}

async function uninstallCertLinux(sudoPassword) {
  const destFile = `${LINUX_CERT_DIR}/9router-mitm.crt`;
  const cmd = `rm -f "${destFile}" && (update-ca-certificates 2>/dev/null || update-ca-trust 2>/dev/null || true)`;
  try {
    await execWithPassword(cmd, sudoPassword);
    console.log("✅ Uninstalled certificate from Linux trust store");
  } catch (error) {
    throw new Error("Failed to uninstall certificate");
  }
}

module.exports = { installCert, uninstallCert, checkCertInstalled };
