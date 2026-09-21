#!/usr/bin/env python3
"""Generate OrcaRouter GUI evidence by driving the real 9Router interface.

Run from a repository checkout:

    python3 scripts/capture-orca-evidence.py

It builds and boots the actual application (no static HTML, no mocked screens),
logs in, installs a dedicated OrcaRouter test connection, then screenshots:

  * the OrcaRouter connect modal, showing both authentication methods side by
    side (OAuth 2.0 + PKCE and a pasted API key, with the stored secret masked)
  * the anchored, capability-filtered model dropdown, whose entries come from
    the live `GET /v1/models` catalog
  * the same dropdown narrowed to models that declare image input

Writes `orca-evidence/manifest.json` plus the PNGs next to it. The manifest is
consumed by the campaign evidence validator; it is generated output and is not
committed.

The API key is read from ORCAROUTER_API_KEY when present (so the dropdown
exercises real live discovery) and never appears in the manifest, a log, or the
browser: the discovery route holds it server-side and returns model metadata
only.
"""

import hashlib
import json
import os
import pathlib
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "orca-evidence"
CATALOG_SOURCE = "https://api.orcarouter.ai/v1/models?capability=chat"
PASSWORD = "orca-gui-pass"
JWT_SECRET = "orca-evidence-jwt-secret"
CHROMIUM = "/usr/bin/chromium"

manifest = {
    "automation": {
        "framework": "playwright",
        "passed": False,
        "catalog_source": CATALOG_SOURCE,
        "catalog_model_count": 0,
        "image_model_count": 0,
    },
    "artifacts": [],
    "notes": [],
}


def log(message):
    print("[orca-evidence] " + message, flush=True)


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def run(argv, **kwargs):
    log("$ " + " ".join(str(a) for a in argv))
    return subprocess.run(argv, cwd=ROOT, check=True, **kwargs)


def build():
    """Produce the standalone server the real deployment runs."""
    if (ROOT / ".next" / "standalone" / "custom-server.js").is_file():
        log("reusing existing standalone build")
        return
    run(["node", "node_modules/next/dist/bin/next", "build"])
    # `postbuild` copies static assets + public/ into the standalone tree; without
    # it every /_next/static chunk 404s and the page cannot hydrate.
    run(["node", "scripts/copy-standalone-assets.mjs"])


def wait_for_health(base, timeout=90):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(base + "/api/health", timeout=3) as response:
                if response.status == 200:
                    return True
        except (urllib.error.URLError, OSError):
            time.sleep(1)
    return False


def start_server(port, data_dir):
    env = dict(os.environ)
    env.update({
        "DATA_DIR": data_dir,
        "JWT_SECRET": JWT_SECRET,
        "INITIAL_PASSWORD": PASSWORD,
        "NODE_ENV": "production",
        "PORT": str(port),
    })
    log("starting standalone server on port " + str(port))
    return subprocess.Popen(
        ["node", "custom-server.js"],
        cwd=ROOT / ".next" / "standalone",
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


def stop_server(process):
    if process is None or process.poll() is not None:
        return
    try:
        os.killpg(os.getpgid(process.pid), signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        process.terminate()
    try:
        process.wait(timeout=15)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(os.getpgid(process.pid), signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            process.kill()


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def record(kind, path, ui, width, height):
    manifest["artifacts"].append({
        "kind": kind,
        "path": path.name,
        "sha256": sha256(path),
        "width": width,
        "height": height,
        "ui": ui,
    })


def panel_surface(page):
    """The painted surface of the open dropdown, plus its geometry."""
    return page.evaluate(
        """() => {
            const panel = document.querySelector('[data-testid="orca-model-panel"]');
            if (!panel) return null;
            const cs = getComputedStyle(panel);
            const rect = panel.getBoundingClientRect();
            return {
                background: cs.backgroundColor,
                borderTopWidth: cs.borderTopWidth,
                rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            };
        }"""
    )


def trigger_right_delta(page, surface):
    box = page.locator('[data-testid="orca-model-trigger"]').bounding_box()
    panel = surface["rect"]
    return abs((box["x"] + box["width"]) - (panel["x"] + panel["width"]))


def dropdown_ui(page, surface, item_count):
    background = surface["background"]
    return {
        "dropdown_open": page.locator('[data-testid="orca-model-panel"]').count() == 1,
        "item_count": item_count,
        "opaque_background": bool(background) and background.startswith("rgb("),
        "visible_border": surface["borderTopWidth"] not in ("0px", "", None),
        "trigger_panel_right_delta": round(trigger_right_delta(page, surface), 2),
    }


def wait_for_options(page, expected, timeout=30):
    """Poll until the dropdown renders exactly the expected slice, or time out.

    Equality (not `>=`) matters: the multimodal slice is a strict subset of the
    text slice, so a `>=` wait would return while the previous, larger list is
    still on screen and the screenshot would show the wrong catalog.
    """
    deadline = time.time() + timeout
    count = page.locator('[data-testid="orca-model-option"]').count()
    while time.time() < deadline and count != expected:
        page.wait_for_timeout(500)
        count = page.locator('[data-testid="orca-model-option"]').count()
    return count


def main():
    from playwright.sync_api import sync_playwright

    api_key = os.environ.get("ORCAROUTER_API_KEY")
    if not api_key:
        log("ORCAROUTER_API_KEY is not set; the catalog will degrade to the verified seed")
    # A synthetic placeholder keeps the flow runnable without a real key, and is
    # unmistakably fake so it can never be mistaken for a live credential.
    connection_key = api_key or "sk-orca-evidence-fake-0000000000"

    OUT.mkdir(exist_ok=True)
    for stale in OUT.glob("*.png"):
        stale.unlink()

    build()
    port = free_port()
    base = "http://127.0.0.1:" + str(port)
    data_dir = tempfile.mkdtemp(prefix="orca-evidence-data-")
    server = start_server(port, data_dir)

    try:
        if not wait_for_health(base):
            raise SystemExit("the application did not become healthy")

        with sync_playwright() as pw:
            browser = pw.chromium.launch(executable_path=CHROMIUM, args=["--no-sandbox"])
            context = browser.new_context(viewport={"width": 1440, "height": 900})
            page = context.new_page()

            page.goto(base + "/login", wait_until="domcontentloaded")
            login = context.request.post(base + "/api/auth/login", data={"password": PASSWORD})
            assert login.status == 200, "login failed: " + str(login.status)

            # A dedicated test connection: the dropdown then exercises real live
            # discovery, and the modal can show a stored (redacted) key.
            created = context.request.post(base + "/api/providers", data={
                "provider": "orcarouter",
                "apiKey": connection_key,
                "name": "OrcaRouter Evidence",
            })
            assert created.status in (200, 201), "connection create failed: " + created.text()[:200]

            connections = context.request.get(base + "/api/providers").json()["connections"]
            orca = [c for c in connections if c["provider"] == "orcarouter"][0]

            # The browser must only ever receive a redacted handle.
            hint = orca.get("keyHint") or ""
            assert hint.startswith("sk-orca-"), "unexpected keyHint shape: " + repr(hint)
            assert connection_key not in hint, "keyHint exposed more than a redacted handle"
            assert orca.get("apiKey") is None, "API key leaked through the connections API"

            # ── catalog counts, read through the product's own discovery route ──
            def catalog(query):
                response = context.request.get(base + "/api/providers/" + orca["id"] + "/models?" + query)
                assert response.status == 200, "catalog request failed: " + str(response.status)
                return response.json()

            chat = catalog("capability=chat")
            for _ in range(3):
                if chat.get("source") == "live":
                    break
                page.wait_for_timeout(1500)
                chat = catalog("capability=chat")
            assert chat.get("source") == "live", (
                "live catalog unavailable (source=" + str(chat.get("source"))
                + "); evidence must show the authoritative live list"
            )
            image = catalog("capability=chat&modality=image")
            manifest["automation"]["catalog_model_count"] = len(chat.get("models", []))
            manifest["automation"]["image_model_count"] = len(image.get("models", []))
            assert manifest["automation"]["catalog_model_count"] > 0, "live chat catalog is empty"
            log("live catalog: " + str(manifest["automation"]["catalog_model_count"]) + " chat, "
                + str(manifest["automation"]["image_model_count"]) + " image-input")

            # ── screenshot 1: both authentication methods ───────────────────────
            page.goto(base + "/dashboard/providers/orcarouter", wait_until="domcontentloaded")
            auth_button = page.get_by_role("button", name="OrcaRouter - Auth").first
            auth_button.wait_for(state="visible", timeout=30000)
            auth_button.click()
            page.wait_for_selector('[data-testid="orca-tab-auth"]', timeout=20000)
            page.wait_for_timeout(500)

            api_key_visible = page.locator('[data-testid="orca-tab-api"]').count() == 1
            pkce_visible = page.locator('[data-testid="orca-tab-auth"]').count() == 1
            page.locator('[data-testid="orca-tab-api"]').click()
            page.wait_for_timeout(1000)
            masked = page.query_selector('[data-testid="orca-api-key-masked"]')
            masked_text = masked.inner_text() if masked else ""
            secret_masked = (
                masked_text.startswith("Stored key: sk-orca-")
                and "\u2026" in masked_text
                and connection_key not in masked_text
            )
            controls_enabled = (
                page.locator('[data-testid="orca-api-key-input"]').is_enabled()
                and page.get_by_role("button", name="Save API key").is_enabled()
            )
            # Prove both entrances are on screen together: the OAuth tab must still
            # be present and selectable while the API-key panel is open.
            assert api_key_visible and pkce_visible, "both auth entrances must be visible"
            assert secret_masked, "the stored key must be shown only as a redacted handle"
            assert controls_enabled, "the API-key controls must be usable"

            auth_path = OUT / "auth-methods.png"
            page.screenshot(path=str(auth_path))
            record("auth-methods", auth_path, {
                "api_key_visible": api_key_visible,
                "pkce_visible": pkce_visible,
                "secret_masked": secret_masked,
                "controls_enabled": controls_enabled,
                "masked_text": masked_text,
            }, 1440, 900)

            # ── screenshot 2: anchored dropdown, live text slice ────────────────
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)
            trigger = page.locator('[data-testid="orca-model-trigger"]')
            trigger.wait_for(state="visible", timeout=30000)
            trigger.click()
            page.wait_for_selector('[data-testid="orca-model-panel"]', timeout=20000)
            text_count = wait_for_options(page, manifest["automation"]["catalog_model_count"])
            surface = panel_surface(page)
            assert surface, "the dropdown panel is not rendered"
            text_ui = dropdown_ui(page, surface, text_count)
            assert text_ui["dropdown_open"], "the text dropdown is not open"
            assert text_ui["item_count"] == manifest["automation"]["catalog_model_count"], (
                "the dropdown shows " + str(text_ui["item_count"]) + " entries but the live catalog has "
                + str(manifest["automation"]["catalog_model_count"])
            )
            assert text_ui["opaque_background"] and text_ui["visible_border"], "the dropdown has no visible surface"
            assert abs(text_ui["trigger_panel_right_delta"]) <= 2, (
                "the dropdown is not anchored to its trigger (delta="
                + str(text_ui["trigger_panel_right_delta"]) + ")"
            )
            assert connection_key not in page.content(), "the API key must never reach the DOM"

            text_path = OUT / "text-model-dropdown.png"
            page.screenshot(path=str(text_path))
            record("text-model-dropdown", text_path, text_ui, 1440, 900)

            # ── screenshot 3: multimodal slice (models declaring image input) ───
            page.check('[data-testid="orca-image-only"]')
            image_count = wait_for_options(page, manifest["automation"]["image_model_count"])
            page.wait_for_timeout(800)
            surface = panel_surface(page)
            image_ui = dropdown_ui(page, surface, image_count)
            assert image_ui["item_count"] == manifest["automation"]["image_model_count"], (
                "the image slice shows " + str(image_ui["item_count"]) + " entries but the catalog has "
                + str(manifest["automation"]["image_model_count"])
            )
            assert image_ui["opaque_background"] and image_ui["visible_border"], "the dropdown has no visible surface"
            assert abs(image_ui["trigger_panel_right_delta"]) <= 2, (
                "the multimodal dropdown is not anchored to its trigger (delta="
                + str(image_ui["trigger_panel_right_delta"]) + ")"
            )
            # Fail-closed check: every rendered entry must declare image input.
            rendered_ids = page.eval_on_selector_all(
                '[data-testid="orca-model-option"]',
                "els => els.map(e => (e.innerText || '').split('\\n').pop())",
            )
            declared = {m["id"] for m in image.get("models", [])}
            assert set(rendered_ids) == declared, (
                "the multimodal dropdown does not match the declared image-input catalog: "
                + repr(sorted(set(rendered_ids) ^ declared))
            )

            image_path = OUT / "multimodal-model-dropdown.png"
            page.screenshot(path=str(image_path))
            record("multimodal-model-dropdown", image_path, image_ui, 1440, 900)

            manifest["notes"].append(
                "Multimodal slice captured through the same capability-scoped endpoint the "
                "Capacity Adapter's Vision cap uses (?capability=chat&modality=image), so "
                "models that do not declare image input are excluded (fail closed)."
            )
            browser.close()

        manifest["automation"]["passed"] = True
    finally:
        stop_server(server)
        shutil.rmtree(data_dir, ignore_errors=True)

    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    log("wrote " + str(OUT / "manifest.json"))
    print(json.dumps(manifest["automation"], indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
