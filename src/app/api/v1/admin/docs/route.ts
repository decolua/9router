// Minimal self-contained docs page. No external scripts — preserves
// offline/self-hosted operation. The spec endpoint is the real deliverable;
// this page is a convenience reader.
const HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>9Router Management API Docs</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { font-family: system-ui, sans-serif; max-width: 960px; margin: 24px auto; padding: 0 16px; color: #1a1a1a; }
  h1 { font-size: 1.5rem; } h2 { font-size: 1.1rem; margin-top: 1.5rem; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  code, pre { font-family: ui-monospace, monospace; background: #f5f5f5; padding: 2px 4px; border-radius: 3px; }
  pre { padding: 12px; overflow: auto; }
  .endpoint { background: #fafafa; border: 1px solid #eee; padding: 12px; margin: 8px 0; border-radius: 4px; }
  .method { display: inline-block; padding: 2px 8px; border-radius: 3px; font-weight: 600; color: white; margin-right: 6px; }
  .get { background: #2b7; } .post { background: #37c; } .patch { background: #e8a000; } .delete { background: #d33; }
  .role { background: #555; padding: 1px 6px; border-radius: 3px; color: white; font-size: 0.8em; margin-left: 8px; }
</style></head><body>
<h1>9Router Management &amp; Control API</h1>
<p>Fetch the live OpenAPI spec from <a href="/api/v1/admin/openapi.json"><code>/api/v1/admin/openapi.json</code></a>.</p>
<div id="list">Loading\u2026</div>
<script>
fetch("/api/v1/admin/openapi.json").then(r => r.json()).then(spec => {
  const out = document.getElementById("list");
  out.innerHTML = "";
  for (const [path, methods] of Object.entries(spec.paths || {})) {
    const sec = document.createElement("div");
    sec.innerHTML = "<h2><code>" + path + "</code></h2>";
    for (const [m, op] of Object.entries(methods)) {
      if (m === "parameters") continue;
      const ep = document.createElement("div");
      ep.className = "endpoint";
      ep.innerHTML = '<span class="method ' + m + '">' + m.toUpperCase() + "</span> " +
        "<strong>" + (op.summary || "") + "</strong>" +
        (op["x-role"] === "admin" ? '<span class="role">admin</span>' : "") +
        '<pre>curl -H "Authorization: Bearer YOUR_KEY" \\\n     ' + window.location.origin + path + "</pre>";
      sec.appendChild(ep);
    }
    out.appendChild(sec);
  }
}).catch(e => { document.getElementById("list").textContent = "Error: " + e.message; });
</script>
</body></html>`;

export const dynamic = "force-dynamic";

export async function GET() {
  return new Response(HTML, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
