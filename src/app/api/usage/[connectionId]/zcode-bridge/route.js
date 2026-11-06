import { getProviderConnectionById, getProviderConnections } from "@/lib/db/index.js";

function sanitizeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function GET(request, { params }) {
  const { connectionId } = params;
  let connection = null;

  if (connectionId && connectionId !== "undefined" && connectionId !== "null" && connectionId !== "default") {
    connection = await getProviderConnectionById(connectionId);
  }

  // Graceful fallback: If connectionId is 'undefined' or not found, resolve first GLM connection with ZCode token
  if (!connection) {
    const allConns = await getProviderConnections();
    connection =
      allConns.find((c) => (c.provider === "glm" || c.provider === "zai-web") && c.providerSpecificData?.zcodeJwtToken) ||
      allConns.find((c) => c.provider === "glm") ||
      allConns.find((c) => c.provider === "zai-web") ||
      null;
  }

  if (!connection) {
    return new Response(
      `<!DOCTYPE html><html><body style="background:#0b0f17;color:#fff;font-family:sans-serif;padding:40px;text-align:center;"><h2>Connection Not Found</h2><p>GLM connection ID is invalid or was removed.</p></body></html>`,
      { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  const email = sanitizeHtml(connection.email || connection.name || "GLM Account");
  const zcodeJwtToken =
    connection.providerSpecificData?.zcodeJwtToken ||
    connection.providerSpecificData?.zaiBusinessToken ||
    "";
  const accessToken =
    connection.accessToken ||
    connection.apiKey ||
    connection.providerSpecificData?.zaiBusinessToken ||
    "";

  const consoleSnippet = `localStorage.setItem('zcodejwttoken', '${zcodeJwtToken}');\nlocalStorage.setItem('oauth:zai:access_token', '${accessToken}');\nlocalStorage.setItem('oauth:active_provider', 'zai');\nlocation.reload();`;

  const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ZCode Web Claim Launcher - ${email}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0B0F17;
      color: #E2E8F0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px 16px;
    }
    .card {
      width: 100%;
      max-width: 500px;
      background: #151D2C;
      border: 1px solid #233045;
      border-radius: 16px;
      padding: 24px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
    }
    .header {
      margin-bottom: 18px;
    }
    .badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 3px 8px;
      background: rgba(59, 130, 246, 0.15);
      color: #60A5FA;
      border-radius: 6px;
      margin-bottom: 6px;
    }
    h1 {
      font-size: 18px;
      font-weight: 700;
      color: #F8FAFC;
    }
    .account {
      font-size: 12px;
      color: #94A3B8;
      margin-top: 2px;
      font-family: monospace;
    }
    .alert-box {
      font-size: 12px;
      color: #CBD5E1;
      line-height: 1.5;
      margin-bottom: 18px;
      background: rgba(59, 130, 246, 0.08);
      border-left: 3px solid #3B82F6;
      padding: 10px 12px;
      border-radius: 4px;
    }
    .step-box {
      background: #0F1622;
      border: 1px solid #233045;
      border-radius: 12px;
      padding: 14px;
      margin-bottom: 14px;
    }
    .step-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .step-num {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: #2563EB;
      color: #FFF;
      font-size: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      shrink: 0;
    }
    .step-title {
      font-size: 13px;
      font-weight: 600;
      color: #F1F5F9;
    }
    .step-desc {
      font-size: 12px;
      color: #94A3B8;
      line-height: 1.4;
      margin-bottom: 10px;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      width: 100%;
      padding: 10px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.15s ease;
      border: none;
    }
    .btn-primary {
      background: #2563EB;
      color: #FFF;
    }
    .btn-primary:hover {
      background: #1D4ED8;
    }
    .btn-green {
      background: #059669;
      color: #FFF;
    }
    .btn-green:hover {
      background: #047857;
    }
    .btn-secondary {
      background: #1E293B;
      color: #E2E8F0;
      border: 1px solid #334155;
    }
    .btn-secondary:hover {
      background: #334155;
    }
    .divider {
      text-align: center;
      font-size: 11px;
      color: #64748B;
      margin: 16px 0 12px;
      position: relative;
    }
    .divider::before, .divider::after {
      content: "";
      position: absolute;
      top: 50%;
      width: 38%;
      height: 1px;
      background: #233045;
    }
    .divider::before { left: 0; }
    .divider::after { right: 0; }
    .toast {
      font-size: 11px;
      color: #10B981;
      text-align: center;
      margin-top: 6px;
      min-height: 16px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <span class="badge">ZCode Web Claim</span>
      <h1>Klaim Voucher ZCode di Browser</h1>
      <div class="account">${email}</div>
    </div>

    <div class="alert-box">
      Halaman Rewards ZCode memerlukan sesi login di browser kamu. Ikuti 2 langkah mudah di bawah untuk membukanya langsung:
    </div>

    <!-- Step 1 -->
    <div class="step-box">
      <div class="step-header">
        <span class="step-num">1</span>
        <span class="step-title">Login ke ZCode (Satu Kali)</span>
      </div>
      <p class="step-desc">
        Buka halaman login ZCode di bawah, lalu klik tombol <b>"Continue with Z.ai"</b> menggunakan akun yang sama:
      </p>
      <a href="https://zcode.z.ai/en/login" target="_blank" rel="noopener noreferrer" class="btn btn-primary">
        Buka Login ZCode Web
      </a>
    </div>

    <!-- Step 2 -->
    <div class="step-box">
      <div class="step-header">
        <span class="step-num">2</span>
        <span class="step-title">Buka Halaman Rewards & Voucher</span>
      </div>
      <p class="step-desc">
        Setelah login di Langkah 1 selesai, buka halaman Rewards. Popup tiket 500M / reward task akan langsung muncul dan siap diklaim:
      </p>
      <a href="https://zcode.z.ai/en/rewards?embedded=app&theme=zai-dark" target="_blank" rel="noopener noreferrer" class="btn btn-green">
        Buka Halaman Rewards & Voucher 500M
      </a>
    </div>

    <div class="divider">PENGGUNA PC / LAPTOP</div>

    <div style="background:#0F1622;border:1px solid #233045;border-radius:10px;padding:12px;">
      <p style="font-size:11px;color:#94A3B8;margin-bottom:8px;">
        Jika di PC/Laptop, kamu bisa langsung bypass login dengan paste script token di Console (F12):
      </p>
      <button type="button" class="btn btn-secondary" onclick="copyConsoleSnippet()">
        Salin Script Console (F12)
      </button>
      <div class="toast" id="toastMsg"></div>
    </div>
  </div>

  <script>
    const consoleSnippet = ${JSON.stringify(consoleSnippet)};

    function copyConsoleSnippet() {
      navigator.clipboard.writeText(consoleSnippet).then(() => {
        showToast("Script Console disalin! Buka tab ZCode, tekan F12 -> Console -> Paste & Enter.");
      }).catch(() => {
        fallbackCopy(consoleSnippet);
      });
    }

    function showToast(msg) {
      const el = document.getElementById("toastMsg");
      el.textContent = msg;
      setTimeout(() => { el.textContent = ""; }, 4000);
    }

    function fallbackCopy(text) {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      showToast("Berhasil disalin ke clipboard!");
    }
  </script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
