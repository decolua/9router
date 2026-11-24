"""BTU local gateway: localhost by default; configure TLS reverse proxy for LAN."""
import os
import hmac
import json
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

API_URL = "https://api.3minapi.com/api/v1/data/o8mxl7uhc7371qouz39de"
TOKEN = os.environ.get("BTU_DEVICE_TOKEN", "")
UPSTREAM_KEY = os.environ.get("BTU_3MIN_API_KEY", "")

class Handler(BaseHTTPRequestHandler):
    def respond(self, status, obj):
        payload = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path == "/health":
            return self.respond(200, {"service": "btu-gateway", "ready": bool(TOKEN and UPSTREAM_KEY)})
        return self.respond(404, {"error": "not_found"})

    def do_POST(self):
        if self.path != "/jobs":
            return self.respond(404, {"error": "not_found"})
        if not TOKEN or not UPSTREAM_KEY:
            return self.respond(503, {"error": "gateway_not_configured"})
        supplied = self.headers.get("Authorization", "").removeprefix("Bearer ")
        if not hmac.compare_digest(supplied, TOKEN):
            return self.respond(401, {"error": "unauthorized"})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size <= 0 or size > 16384:
                return self.respond(413, {"error": "invalid_payload_size"})
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict) or not isinstance(data.get("prompt"), str):
                return self.respond(400, {"error": "prompt_required"})
            allowed = {"project_id", "scene_id", "prompt", "character_reference", "wings",
                       "width", "height", "fps", "duration_seconds", "render_status", "output_uri"}
            job = {k: v for k, v in data.items() if k in allowed}
            job["render_status"] = "queued"
            job["output_uri"] = ""
            req = urllib.request.Request(
                API_URL, data=json.dumps(job).encode(), method="POST",
                headers={"Content-Type": "application/json", "Authorization": "Bearer " + UPSTREAM_KEY})
            with urllib.request.urlopen(req, timeout=15) as response:
                self.respond(response.status, json.loads(response.read()))
        except Exception as exc:
            self.respond(502, {"error": "upstream_request_failed", "detail": type(exc).__name__})

if __name__ == "__main__":
    bind = os.environ.get("BTU_BIND", "127.0.0.1")
    port = int(os.environ.get("BTU_PORT", "5000"))
    print(f"BTU gateway listening on {bind}:{port}")
    ThreadingHTTPServer((bind, port), Handler).serve_forever()
