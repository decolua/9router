const path = require("path");
const fs = require("fs");
const { MITM_DIR } = require("../paths");

// Wildcard domains — covers all subdomains without needing cert update per tool
const WILDCARD_DOMAINS = [
  "*.googleapis.com",
  "*.githubcopilot.com",
  "*.individual.githubcopilot.com",
  "*.business.githubcopilot.com"
];

/**
 * Generate self-signed SSL certificate with wildcard SAN.
 * Covers all current and future MITM tool domains automatically.
 * Uses selfsigned (pure JS, no openssl needed).
 */
async function generateCert() {
  const certDir = MITM_DIR;
  const keyPath = path.join(certDir, "server.key");
  const certPath = path.join(certDir, "server.crt");

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    console.log("✅ SSL certificate already exists");
    return { key: keyPath, cert: certPath };
  }

  if (!fs.existsSync(certDir)) {
    fs.mkdirSync(certDir, { recursive: true });
  }

  const selfsigned = require("selfsigned");
  const attrs = [{ name: "commonName", value: "9router-mitm" }];
  const notAfter = new Date();
  notAfter.setFullYear(notAfter.getFullYear() + 1);
  const pems = await selfsigned.generate(attrs, {
    keySize: 2048,
    algorithm: "sha256",
    notAfterDate: notAfter,
    extensions: [
      {
        name: "subjectAltName",
        altNames: WILDCARD_DOMAINS.map(domain => ({ type: 2, value: domain }))
      }
    ]
  });

  fs.writeFileSync(keyPath, pems.private);
  fs.writeFileSync(certPath, pems.cert);

  console.log(`✅ Generated wildcard SSL certificate: ${WILDCARD_DOMAINS.join(", ")}`);
  return { key: keyPath, cert: certPath };
}

module.exports = { generateCert };
