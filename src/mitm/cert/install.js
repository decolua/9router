const fs = require("fs");
const crypto = require("crypto");
const { exec } = require("child_process");
const { execWithPassword, isSudoAvailable } = require("../dns/dnsConfig.js");
const { log, err } = require("../logger");

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
      const fingerprint = getCertFingerprint(certPath).replace(/:/g, "");
      // security verify-cert returns 0 only if cert is trusted by system policy
      exec(`security verify-cert -c "${certPath}" -p ssl -k /Library/Keychains/System.keychain 2>/dev/null`, { windowsHide: true }, (error) => {
        if (!error) return resolve(true);
        // Fallback: check if fingerprint appears in System keychain with trust
        exec(`security dump-trust-settings -d 2>/dev/null | grep -i "${fingerprint}"`, { windowsHide: true }, (err2, stdout2) => {
          resolve(!err2 && !!stdout2?.trim());
        });
      });
    } catch {
      resolve(false);
    }
  });
}

function checkCertInstalledWindows(certPath) {
  return new Promise((resolve) => {
    // Check Root store for our Root CA by common name
    exec("certutil -store Root \"9Router MITM Root CA\"", { windowsHide: true }, (error) => {
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
    log("🔐 Cert: already trusted ✅");
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
  // Remove all old certs with same name first to avoid duplicate/stale cert conflict
  const deleteOld = `security delete-certificate -c "9Router MITM Root CA" /Library/Keychains/System.keychain 2>/dev/null || true`;
  const install = `security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${certPath}"`;
  try {
    await execWithPassword(`${deleteOld} && ${install}`, sudoPassword);
    log("🔐 Cert: ✅ installed to system keychain");
  } catch (error) {
    const msg = error.message?.includes("canceled") ? "User canceled authorization" : "Certificate install failed";
    throw new Error(msg);
  }
}

async function installCertWindows(certPath) {
  // Process already has admin rights — run certutil directly, no UAC needed
  return new Promise((resolve, reject) => {
    exec(
      `certutil -addstore Root "${certPath}"`,
      { windowsHide: true },
      (error) => {
        if (error) reject(new Error(`Failed to install certificate: ${error.message}`));
        else { log("🔐 Cert: ✅ installed to Windows Root store"); resolve(); }
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
    log("🔐 Cert: not found in system store");
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
    log("🔐 Cert: ✅ uninstalled from system keychain");
  } catch (err) {
    throw new Error("Failed to uninstall certificate");
  }
}

async function uninstallCertWindows() {
  // Process already has admin rights — run certutil directly, no UAC needed
  return new Promise((resolve, reject) => {
    exec(
      `certutil -delstore Root "9Router MITM Root CA"`,
      { windowsHide: true },
      (error) => {
        if (error) reject(new Error(`Failed to uninstall certificate: ${error.message}`));
        else { log("🔐 Cert: ✅ uninstalled from Windows Root store"); resolve(); }
      }
    );
  });
}

function checkCertInstalledLinux() {
  const certFile = `${LINUX_CERT_DIR}/9router-root-ca.crt`;
  return Promise.resolve(fs.existsSync(certFile));
}

async function installCertLinux(sudoPassword, certPath) {
  if (!isSudoAvailable()) {
    log(`🔐 Cert: cannot install to system store without sudo — trust this file on clients: ${certPath}`);
    return;
  }
  const destFile = `${LINUX_CERT_DIR}/9router-root-ca.crt`;
  // Try update-ca-certificates (Debian/Ubuntu), fallback to update-ca-trust (Fedora/RHEL)
  const cmd = `cp "${certPath}" "${destFile}" && (update-ca-certificates 2>/dev/null || update-ca-trust 2>/dev/null || true)`;
  try {
    await execWithPassword(cmd, sudoPassword);
    log("🔐 Cert: ✅ installed to Linux trust store");
  } catch (error) {
    throw new Error("Certificate install failed");
  }
}

async function uninstallCertLinux(sudoPassword) {
  if (!isSudoAvailable()) {
    return;
  }
  const destFile = `${LINUX_CERT_DIR}/9router-root-ca.crt`;
  const cmd = `rm -f "${destFile}" && (update-ca-certificates 2>/dev/null || update-ca-trust 2>/dev/null || true)`;
  try {
    await execWithPassword(cmd, sudoPassword);
    log("🔐 Cert: ✅ uninstalled from Linux trust store");
  } catch (error) {
    throw new Error("Failed to uninstall certificate");
  }
}

module.exports = { installCert, uninstallCert, checkCertInstalled };
