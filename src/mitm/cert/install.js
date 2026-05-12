const fs = require("fs");
const crypto = require("crypto");
const { exec } = require("child_process");
const { execWithPassword, isSudoAvailable } = require("../dns/dnsConfig.js");
const { runElevatedPowerShell, quotePs } = require("../winElevated.js");
const { log, err } = require("../logger");

const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const LINUX_CERT_PATHS = [
  // Debian / Ubuntu
  { dir: "/usr/local/share/ca-certificates", cmd: "update-ca-certificates" },
  // Arch Linux / CachyOS / Manjaro
  { dir: "/etc/ca-certificates/trust-source/anchors", cmd: "update-ca-trust" },
  // Fedora / RHEL / CentOS
  { dir: "/etc/pki/ca-trust/source/anchors", cmd: "update-ca-trust" },
  // openSUSE
  { dir: "/etc/pki/trust/anchors", cmd: "update-ca-certificates" }
];

function getLinuxCertConfig() {
  for (const config of LINUX_CERT_PATHS) {
    if (fs.existsSync(config.dir)) {
      return config;
    }
  }
  // Fallback to Debian default if none exist
  return LINUX_CERT_PATHS[0];
}
const ROOT_CA_CN = "9Router MITM Root CA";

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
    // Check by SHA1 fingerprint — detects stale cert with same CN but different key
    let fingerprint;
    try {
      fingerprint = getCertFingerprint(certPath).replace(/:/g, "");
    } catch {
      return resolve(false);
    }
    exec(`certutil -store Root ${fingerprint}`, { windowsHide: true }, (error) => {
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
  // Auto-elevate via UAC popup if not admin (zero popup if already admin).
  // Delete any stale cert with same CN before adding to avoid duplicates.
  const script = `
    certutil -delstore Root ${quotePs(ROOT_CA_CN)} 2>$null | Out-Null
    $exit = & certutil -addstore Root ${quotePs(certPath)} 2>&1
    if ($LASTEXITCODE -ne 0) { throw "certutil exit $LASTEXITCODE" }
  `;
  try {
    await runElevatedPowerShell(script);
    log("🔐 Cert: ✅ installed to Windows Root store");
  } catch (e) {
    throw new Error(`Failed to install certificate: ${e.message}`);
  }
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
  // Auto-elevate via UAC popup if not admin
  const script = `certutil -delstore Root ${quotePs(ROOT_CA_CN)}`;
  try {
    await runElevatedPowerShell(script);
    log("🔐 Cert: ✅ uninstalled from Windows Root store");
  } catch (e) {
    throw new Error(`Failed to uninstall certificate: ${e.message}`);
  }
}

function checkCertInstalledLinux() {
  const config = getLinuxCertConfig();
  const certFile = `${config.dir}/9router-root-ca.crt`;
  return Promise.resolve(fs.existsSync(certFile));
}

async function updateNssDatabases(certPath, action = 'add') {
  const certName = "9Router MITM Root CA";
  
  const script = `
    if ! command -v certutil &> /dev/null; then
      exit 0
    fi
    
    DIRS="$HOME/.pki/nssdb $HOME/snap/chromium/current/.pki/nssdb"
    
    if [ -d "$HOME/.mozilla/firefox" ]; then
      for profile in "$HOME"/.mozilla/firefox/*/; do
        if [ -f "\${profile}cert9.db" ] || [ -f "\${profile}cert8.db" ]; then
          DIRS="$DIRS $profile"
        fi
      done
    fi

    if [ -d "$HOME/snap/firefox/common/.mozilla/firefox" ]; then
      for profile in "$HOME"/snap/firefox/common/.mozilla/firefox/*/; do
        if [ -f "\${profile}cert9.db" ] || [ -f "\${profile}cert8.db" ]; then
          DIRS="$DIRS $profile"
        fi
      done
    fi

    for db in $DIRS; do
      if [ -d "$db" ]; then
        if [ "${action}" = "add" ]; then
          certutil -d sql:"$db" -A -t "C,," -n "${certName}" -i "${certPath}" 2>/dev/null || \\
          certutil -d "$db" -A -t "C,," -n "${certName}" -i "${certPath}" 2>/dev/null || true
        else
          certutil -d sql:"$db" -D -n "${certName}" 2>/dev/null || \\
          certutil -d "$db" -D -n "${certName}" 2>/dev/null || true
        fi
      fi
    done
  `;
  
  return new Promise((resolve) => {
    exec(script, { shell: "/bin/bash" }, () => resolve());
  });
}

async function installCertLinux(sudoPassword, certPath) {
  if (!isSudoAvailable()) {
    log(`🔐 Cert: cannot install to system store without sudo — trust this file on clients: ${certPath}`);
    // Still try to update user NSS DBs even if no sudo!
    await updateNssDatabases(certPath, 'add');
    return;
  }
  
  const config = getLinuxCertConfig();
  const destFile = `${config.dir}/9router-root-ca.crt`;
  
  // Copy to the discovered directory and execute the specific update command
  const cmd = `cp "${certPath}" "${destFile}" && (${config.cmd} 2>/dev/null || true)`;
  
  try {
    await execWithPassword(cmd, sudoPassword);
    await updateNssDatabases(certPath, 'add');
    log(`🔐 Cert: ✅ installed to Linux trust store (${config.dir}) and user browser databases`);
  } catch (error) {
    throw new Error(`Certificate install failed: ${error.message}`);
  }
}

async function uninstallCertLinux(sudoPassword) {
  // Always try to uninstall from user DBs even without sudo
  await updateNssDatabases(null, 'delete');

  if (!isSudoAvailable()) {
    return;
  }
  
  const config = getLinuxCertConfig();
  const destFile = `${config.dir}/9router-root-ca.crt`;
  const cmd = `rm -f "${destFile}" && (${config.cmd} 2>/dev/null || true)`;
  
  try {
    await execWithPassword(cmd, sudoPassword);
    log("🔐 Cert: ✅ uninstalled from Linux trust store and user browser databases");
  } catch (error) {
    throw new Error("Failed to uninstall certificate");
  }
}

module.exports = { installCert, uninstallCert, checkCertInstalled };
