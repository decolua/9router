const path = require("path");
const fs = require("fs");
const { X509Certificate } = require("crypto");
const selfsigned = require("selfsigned");
const { MITM_DIR } = require("../paths");

const ROOT_CA_KEY_PATH = path.join(MITM_DIR, "rootCA.key");
const ROOT_CA_CERT_PATH = path.join(MITM_DIR, "rootCA.crt");

/**
 * Check if cert file is expired or expiring within 30 days
 */
function isCertExpired(certPath) {
  try {
    const cert = new X509Certificate(fs.readFileSync(certPath));
    const expiryThreshold = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    return new Date(cert.validTo) < expiryThreshold;
  } catch {
    return true; // treat unreadable cert as expired
  }
}

/**
 * Generate Root CA certificate (only once, auto-regenerate if expired)
 * This Root CA will sign all dynamic leaf certificates
 */
async function generateRootCA() {
  const exists = fs.existsSync(ROOT_CA_KEY_PATH) && fs.existsSync(ROOT_CA_CERT_PATH);
  if (exists && !isCertExpired(ROOT_CA_CERT_PATH)) {
    console.log("✅ Root CA already exists");
    return { key: ROOT_CA_KEY_PATH, cert: ROOT_CA_CERT_PATH };
  }
  if (exists) {
    console.log("🔐 Root CA expired or expiring soon — regenerating...");
    try { fs.unlinkSync(ROOT_CA_KEY_PATH); } catch { /* ignore */ }
    try { fs.unlinkSync(ROOT_CA_CERT_PATH); } catch { /* ignore */ }
  }

  if (!fs.existsSync(MITM_DIR)) {
    fs.mkdirSync(MITM_DIR, { recursive: true });
  }

  console.log("🔐 Generating Root CA certificate...");

  const attrs = [
    { name: "commonName", value: "9Router MITM Root CA" },
    { name: "organizationName", value: "9Router" },
    { name: "countryName", value: "US" }
  ];
  const notBeforeDate = new Date();
  const notAfterDate = new Date(notBeforeDate);
  notAfterDate.setFullYear(notAfterDate.getFullYear() + 10);
  const pems = await selfsigned.generate(attrs, {
    algorithm: "sha256",
    keySize: 2048,
    notBeforeDate,
    notAfterDate,
    extensions: [
      { name: "basicConstraints", cA: true, critical: true },
      { name: "keyUsage", keyCertSign: true, cRLSign: true, critical: true }
    ]
  });

  fs.writeFileSync(ROOT_CA_KEY_PATH, pems.private, { mode: 0o600 });
  fs.writeFileSync(ROOT_CA_CERT_PATH, pems.cert, { mode: 0o644 });

  console.log("✅ Root CA generated successfully");
  return { key: ROOT_CA_KEY_PATH, cert: ROOT_CA_CERT_PATH };
}

/**
 * Load Root CA from disk
 */
function loadRootCA() {
  if (!fs.existsSync(ROOT_CA_KEY_PATH) || !fs.existsSync(ROOT_CA_CERT_PATH)) {
    throw new Error("Root CA not found. Generate it first.");
  }

  const keyPem = fs.readFileSync(ROOT_CA_KEY_PATH, "utf8");
  const certPem = fs.readFileSync(ROOT_CA_CERT_PATH, "utf8");

  return { key: keyPem, cert: certPem };
}

/**
 * Generate leaf certificate for a specific domain, signed by Root CA
 */
async function generateLeafCert(domain, rootCA) {
  const notBeforeDate = new Date();
  const notAfterDate = new Date(notBeforeDate);
  notAfterDate.setFullYear(notAfterDate.getFullYear() + 1);
  const pems = await selfsigned.generate([{ name: "commonName", value: domain }], {
    algorithm: "sha256",
    keySize: 2048,
    notBeforeDate,
    notAfterDate,
    ca: rootCA,
    extensions: [
      { name: "basicConstraints", cA: false },
      { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
      { name: "extKeyUsage", serverAuth: true, clientAuth: true },
      {
        name: "subjectAltName",
        altNames: [
          { type: 2, value: domain },
          { type: 2, value: `*.${domain}` }
        ]
      }
    ]
  });

  return { key: pems.private, cert: pems.cert };
}

module.exports = {
  generateRootCA,
  loadRootCA,
  generateLeafCert,
  isCertExpired,
  ROOT_CA_CERT_PATH,
  ROOT_CA_KEY_PATH
};
