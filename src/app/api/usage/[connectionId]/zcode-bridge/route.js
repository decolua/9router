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
      allConns.find((c) => c.provider === "glm" && c.providerSpecificData?.zcodeJwtToken) ||
      allConns.find((c) => c.provider === "glm") ||
      allConns.find((c) => c.provider === "zcode" || c.provider === "zc") ||
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
<html lang="en">
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
      <h1>Claim a ZCode Voucher in Your Browser</h1>
      <div class="account">${email}</div>
    </div>

    <div class="alert-box">
      ZCode Rewards requires a browser login session. Follow the two steps below to open the page directly:
    </div>

    <!-- Step 1 -->
    <div class="step-box">
      <div class="step-header">
        <span class="step-num">1</span>
        <span class="step-title">Sign in to ZCode (One Time)</span>
      </div>
      <p class="step-desc">
        Open the ZCode sign-in page below, then select <b>"Continue with Z.ai"</b> using the same account:
      </p>
      <a href="https://zcode.z.ai/en/login" target="_blank" rel="noopener noreferrer" class="btn btn-primary">
        Open ZCode Web Login
      </a>
    </div>

    <!-- Step 2 -->
    <div class="step-box">
      <div class="step-header">
        <span class="step-num">2</span>
        <span class="step-title">Open Rewards and Vouchers</span>
      </div>
      <p class="step-desc">
        After completing Step 1, open the Rewards page. The 500M ticket or reward task should appear, ready to claim:
      </p>
      <a href="https://zcode.z.ai/en/rewards?embedded=app&theme=zai-dark" target="_blank" rel="noopener noreferrer" class="btn btn-green">
        Open Rewards and the 500M Voucher
      </a>
    </div>

    <div class="divider">DESKTOP USERS</div>

    <div style="background:#0F1622;border:1px solid #233045;border-radius:10px;padding:12px;">
      <p style="font-size:11px;color:#94A3B8;margin-bottom:8px;">
        On a desktop or laptop, you can bypass browser login by pasting this token script into the Console (F12):
      </p>
      <button type="button" class="btn btn-secondary" onclick="copyConsoleSnippet()">
        Copy Console Script (F12)
      </button>
      <div class="toast" id="toastMsg"></div>
    </div>
  </div>

  <script>
    const consoleSnippet = ${JSON.stringify(consoleSnippet)};

    function copyConsoleSnippet() {
      navigator.clipboard.writeText(consoleSnippet).then(() => {
        showToast("Console script copied! Open the ZCode tab, press F12, select Console, then paste and press Enter.");
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
      showToast("Copied to clipboard!");
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
