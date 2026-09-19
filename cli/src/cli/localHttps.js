const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const forge = require("node-forge");

function getMitmDir() {
  const appData = process.platform === "win32"
    ? (process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"))
    : os.homedir();
  return path.join(appData, process.platform === "win32" ? "9router" : ".9router", "ssl");
}

const SSL_DIR = getMitmDir();
const CERT_PATH = path.join(SSL_DIR, "local-cursor.crt");
const KEY_PATH = path.join(SSL_DIR, "local-cursor.key");

function generateLocalCert() {
  if (!fs.existsSync(SSL_DIR)) {
    fs.mkdirSync(SSL_DIR, { recursive: true });
  }

  if (fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH)) {
    try {
      const certPem = fs.readFileSync(CERT_PATH, "utf8");
      const cert = forge.pki.certificateFromPem(certPem);
      if (cert.validity.notAfter > new Date()) {
        return {
          cert: certPem,
          key: fs.readFileSync(KEY_PATH, "utf8")
        };
      }
    } catch {}
  }

  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = Math.floor(Math.random() * 1000000).toString();
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 5);

  const attrs = [
    { name: "commonName", value: "127.0.0.1" },
    { name: "organizationName", value: "9Router Local Cursor" }
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);

  cert.setExtensions([
    { name: "basicConstraints", cA: true },
    { name: "keyUsage", keyCertSign: true, digitalSignature: true, keyEncipherment: true },
    { name: "extKeyUsage", serverAuth: true, clientAuth: true },
    {
      name: "subjectAltName",
      altNames: [
        { type: 2, value: "localhost" },
        { type: 7, ip: "127.0.0.1" }
      ]
    }
  ]);

  cert.sign(keys.privateKey, forge.md.sha256.create());

  const certPem = forge.pki.certificateToPem(cert);
  const keyPem = forge.pki.privateKeyToPem(keys.privateKey);

  fs.writeFileSync(CERT_PATH, certPem, "utf8");
  fs.writeFileSync(KEY_PATH, keyPem, "utf8");

  return { cert: certPem, key: keyPem };
}

let httpsServer = null;
let proxyAgent = null;

function getProxyAgent() {
  if (!proxyAgent) {
    proxyAgent = new http.Agent({
      keepAlive: true,
      keepAliveMsecs: 60000,
      maxSockets: 100,
      maxFreeSockets: 20
    });
  }
  return proxyAgent;
}

function startLocalHttpsProxy({ httpPort = 20128, httpsPort = 20129 } = {}) {
  if (httpsServer) return Promise.resolve(httpsPort);

  return new Promise((resolve, reject) => {
    try {
      const { cert, key } = generateLocalCert();
      const agent = getProxyAgent();

      httpsServer = https.createServer({ cert, key }, (req, res) => {
        req.socket?.setNoDelay?.(true);

        const options = {
          hostname: "127.0.0.1",
          port: httpPort,
          path: req.url,
          method: req.method,
          agent,
          headers: {
            ...req.headers,
            host: `127.0.0.1:${httpPort}`,
            "x-forwarded-proto": "https"
          }
        };

        const proxyReq = http.request(options, (proxyRes) => {
          proxyRes.socket?.setNoDelay?.(true);
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res, { end: true });
        });

        proxyReq.on("error", (err) => {
          if (!res.headersSent) {
            res.writeHead(502, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: `Local gateway not reachable on port ${httpPort}: ${err.message}` }));
          }
        });

        req.pipe(proxyReq, { end: true });
      });

      httpsServer.on("error", (err) => {
        if (err.code === "EADDRINUSE") {
          console.log(`[HTTPS Proxy] Port ${httpsPort} in use, skipping`);
          resolve(httpsPort);
        } else {
          reject(err);
        }
      });

      httpsServer.listen(httpsPort, "127.0.0.1", () => {
        console.log(`[HTTPS Proxy] Live at https://127.0.0.1:${httpsPort} -> http://127.0.0.1:${httpPort}`);
        resolve(httpsPort);
      });
    } catch (e) {
      reject(e);
    }
  });
}

function stopLocalHttpsProxy() {
  if (httpsServer) {
    try { httpsServer.close(); } catch {}
    httpsServer = null;
  }
  if (proxyAgent) {
    try { proxyAgent.destroy(); } catch {}
    proxyAgent = null;
  }
}

module.exports = {
  startLocalHttpsProxy,
  stopLocalHttpsProxy,
  CERT_PATH,
  KEY_PATH
};
