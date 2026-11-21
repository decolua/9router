**Date:** 2026-06-18
**Feature:** Auto-Update Feature

# Auto-Update Feature Proposal: Webhook Architecture

This document explains the architecture behind the Auto-Update UI button and how it safely communicates with the host environment to trigger a `docker compose build` without deadlocking the Next.js container.

## 1. The Problem
A standard Docker container cannot easily rebuild or restart itself from the inside. If the Next.js API tries to run a bash script to `git pull` and `docker compose build`, the container might be forcefully killed halfway through the execution, leaving the application in a corrupted state or resulting in a failed build.

## 2. The Solution
We introduce an **Auto-Update Menu Button** on the frontend that triggers an internal Next.js API route (`/api/auto-update`). This API route does **NOT** run the shell commands directly. Instead, it securely forwards the request to a **Host Webhook Listener** running outside the container (on the host).

The host webhook then performs the update safely in the background.

---

## 3. General Implementation Guide

If you wish to adopt this feature officially, you will need the following implementation pieces:

### A. Environment Variables (`.env`)
Users running 9Router should configure their webhook details in the `.env` file so the Next.js container knows where to send the trigger.

```env
# URL of the host webhook listener (can be host.docker.internal, Tailscale IP, or public IP)
WEBHOOK_UPDATE_URL="http://<ip_host>:9099/webhook-update_9router"

# Secret token to authenticate the Next.js container against the host webhook
WEBHOOK_UPDATE_TOKEN="<your-secret-token-of-9router>"
```

### B. The Next.js API Route (`src/app/api/auto-update/route.js`)
Create a generalized API route that reads from the `.env` configuration.

```javascript
import { NextResponse } from 'next/server';

export async function POST(req) {
  try {
    const webhookUrl = process.env.WEBHOOK_UPDATE_URL;
    const webhookToken = process.env.WEBHOOK_UPDATE_TOKEN;

    if (!webhookUrl || !webhookToken) {
      return NextResponse.json({ success: false, message: 'Webhook not configured in .env' }, { status: 501 });
    }

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${webhookToken}`
      }
    });

    if (res.ok) {
      return NextResponse.json({ success: true, message: 'Update triggered in background' });
    } else {
      return NextResponse.json({ success: false, message: 'Webhook failed' }, { status: 500 });
    }
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
```

### C. The Host Webhook Script (`webhook.py`)
This script should run on the host server (ideally via `systemd`). It listens for the authorized POST request and runs the Git/Docker commands.

```python
import http.server
import socketserver
import subprocess
import threading
import json
import logging

PORT = 9099
SECRET_TOKEN = "<your-secret-token-of-9router>"  # Should match the .env WEBHOOK_UPDATE_TOKEN
WEBHOOK_PATH = "/webhook-update_9router"
PROJECT_PATH = "<your-project-path>"

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s')

class WebhookHandler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path != WEBHOOK_PATH:
            self.send_error(404, "Not Found")
            return

        auth_header = self.headers.get('Authorization')
        expected_auth = f"Bearer {SECRET_TOKEN}"

        if auth_header != expected_auth:
            logging.warning("Unauthorized access attempt")
            self.send_error(401, "Unauthorized")
            return

        # Start background thread to avoid blocking the HTTP response
        threading.Thread(target=self.run_update_script).start()

        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({"status": "success", "message": "Update triggered in background"}).encode())

    def run_update_script(self):
        logging.info("Starting update script...")
        script = f'''
        cd {PROJECT_PATH}
        git stash
        git checkout master
        git pull origin master
        git stash pop || true
        docker compose up -d --build
        docker system prune -f
        '''
        try:
            subprocess.run(script, shell=True, check=True, executable='/bin/bash')
            logging.info("Update script completed successfully.")
        except subprocess.CalledProcessError as e:
            logging.error(f"Update script failed: {e}")

Handler = WebhookHandler

with socketserver.TCPServer(("0.0.0.0", PORT), Handler) as httpd:
    logging.info(f"Serving Webhook on port {PORT} for path {WEBHOOK_PATH}")
    httpd.serve_forever()
```

### D. Integration with `dashboardGuard.js`
In order to allow the frontend to access `/api/auto-update` without interference, ensure that the API path is authorized for authenticated users within `src/dashboardGuard.js`.

---

## 4. Conclusion
By separating the trigger (Next.js) from the execution (Host Python Webhook), we achieve a highly resilient CI/CD flow where users can effortlessly keep their 9Router instance up to date without ever leaving the web dashboard.


**Last Updated:** 2026-06-18