/**
 * Landing Page Service
 * Simple health check page for self-hosted worker
 */

/**
 * Create landing page response
 * @returns {Response} HTML response
 */
export function createLandingPageResponse() {
  const html = `<!DOCTYPE html>
<html><head><title>9Router Worker</title></head>
<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0a0a0a;color:#fff">
<div style="text-align:center">
<h1>9Router Worker</h1>
<p style="color:#888">Worker is running. Configure this URL in your 9Router dashboard.</p>
</div>
</body></html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600"
    }
  });
}
