#!/usr/bin/env python3
"""
cf_token_via_session.py
Login ke akun Cloudflare yang ada, buat Workers AI token via session cookie API.
Usage:
  python cf_token_via_session.py --email X --password Y --account-id Z
"""
import argparse, json, time, sys
import requests
from pathlib import Path

def log(m): print(json.dumps({"step": m}), flush=True)
def die(m): print(json.dumps({"status": "error", "error": m}), flush=True); sys.exit(1)


def create_token_with_cookies(cookies: dict, account_id: str) -> str | None:
    """POST /api/v4/user/tokens using browser session cookies."""
    base = "https://dash.cloudflare.com"
    sess = requests.Session()
    sess.cookies.update(cookies)
    sess.headers.update({
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120",
        "Referer": f"{base}/profile/api-tokens/create",
        "Origin": base,
        "Accept": "application/json",
    })

    # A1: Get permission groups to find Workers AI ID
    log("Fetching permission groups...")
    r = sess.get(f"{base}/api/v4/user/tokens/permission_groups", timeout=15)
    log(f"Permission groups status: {r.status_code}")
    if r.status_code != 200:
        log(f"Permission groups response: {r.text[:300]}")
        return None

    pg_data = r.json()
    log(f"Total groups: {len(pg_data.get('result', []))}")

    # Find Workers AI groups
    workers_ai_ids = []
    for pg in pg_data.get('result', []):
        name = pg.get('name', '')
        if 'Workers AI' in name:
            log(f"Found: {name} -> {pg['id']}")
            workers_ai_ids.append({'id': pg['id'], 'name': name})

    if not workers_ai_ids:
        log("No Workers AI permission groups found")
        log(f"All groups: {[p['name'] for p in pg_data.get('result', [])][:20]}")
        return None

    # Prefer Workers AI:Read for safety, otherwise take first
    target_id = workers_ai_ids[0]['id']
    for pg in workers_ai_ids:
        if 'Read' in pg['name']:
            target_id = pg['id']
            break

    log(f"Using permission group ID: {target_id}")

    # A2: Create token
    payload = {
        "name": "9router-workers-ai",
        "policies": [{
            "effect": "allow",
            "resources": {f"com.cloudflare.api.account.{account_id}": "*"},
            "permission_groups": [{"id": target_id}]
        }]
    }

    log(f"Creating token with payload: {json.dumps(payload)}")
    r2 = sess.post(f"{base}/api/v4/user/tokens", json=payload, timeout=15)
    log(f"Create token status: {r2.status_code}")
    resp2 = r2.json()
    log(f"Response: {json.dumps(resp2)[:500]}")

    if resp2.get('success'):
        return resp2['result'].get('value', '')
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--account-id", required=True, dest="account_id")
    parser.add_argument("--headless", action="store_true")
    args = parser.parse_args()

    try:
        from camoufox.sync_api import Camoufox
    except ImportError:
        die("Camoufox tidak terinstall")

    log(f"Login ke CF sebagai {args.email}...")
    with Camoufox(headless=args.headless, os="windows") as browser:
        page = browser.new_page()

        # Navigate to login
        page.goto("https://dash.cloudflare.com/login", wait_until="domcontentloaded", timeout=30000)
        time.sleep(3)

        # Fill login form
        try:
            email_inp = page.locator("input[name='email'], input[type='email']").first
            if email_inp.is_visible(timeout=5000):
                email_inp.fill(args.email)
                time.sleep(0.3)

                pass_inp = page.locator("input[type='password']").first
                if pass_inp.is_visible(timeout=3000):
                    pass_inp.fill(args.password)
                    time.sleep(0.3)

                for sel in ["button[type='submit']", "button:has-text('Log in')", "button:has-text('Sign in')"]:
                    try:
                        btn = page.locator(sel).first
                        if btn.is_visible(timeout=2000):
                            btn.click()
                            break
                    except Exception:
                        continue

                log("Login submitted, waiting...")
                time.sleep(6)
        except Exception as e:
            log(f"Login form error: {e}")

        log(f"Current URL: {page.url}")
        page.screenshot(path="/tmp/cf_login_state.png")

        # Check if logged in
        if "dash.cloudflare.com" not in page.url:
            die(f"Login failed, URL: {page.url}")

        # Extract cookies
        cookies_list = page.context.cookies()
        cookies = {c['name']: c['value'] for c in cookies_list}
        log(f"Got {len(cookies)} cookies: {list(cookies.keys())[:10]}")

        # Create token via API
        token = create_token_with_cookies(cookies, args.account_id)

        if token:
            log(f"TOKEN BERHASIL: {token[:12]}...")
            print(json.dumps({
                "status": "success",
                "workers_ai_token": token,
                "account_id": args.account_id,
                "email": args.email
            }), flush=True)
        else:
            page.screenshot(path="/tmp/cf_session_debug.png")
            die("Token creation via session failed")


if __name__ == "__main__":
    main()
