#!/usr/bin/env python3
"""Proxy smoke-test using Camoufox — matches leoapi-main approach."""
import sys
import json
import time
import argparse

def parse_proxy(proxy_str):
    """Parse any proxy format into Camoufox proxy dict."""
    if not proxy_str:
        return None
    raw = proxy_str.strip()

    import re

    # Correct URL format: http://user:pass@host:port or socks5://host:port
    url_match = re.match(r'^(socks[45]?|https?|http)://(?:([^:@]+):([^@]+)@)?([^:]+):(\d+)$', raw, re.I)
    if url_match:
        proto, user, password, host, port = url_match.groups()
        proxy = {"server": f"{proto}://{host}:{port}"}
        if user: proxy["username"] = user
        if password: proxy["password"] = password
        return proxy

    # Malformed: http://host:port:user:pass (incorrectly stored)
    bad_url = re.match(r'^(https?|socks[45]?)://([^:]+):(\d+):([^:]+):(.+)$', raw, re.I)
    if bad_url:
        proto, host, port, user, password = bad_url.groups()
        return {"server": f"http://{host}:{port}", "username": user, "password": password}

    # Plain: host:port:user:pass
    parts = raw.split(":")
    if len(parts) == 4 and parts[1].isdigit():
        host, port, user, password = parts
        return {"server": f"http://{host}:{port}", "username": user, "password": password}

    # Plain: host:port
    if len(parts) == 2 and parts[1].isdigit():
        return {"server": f"http://{parts[0]}:{parts[1]}"}

    return None

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--proxy", required=True)
    parser.add_argument("--headless", action="store_true", default=True)
    args = parser.parse_args()

    proxy = parse_proxy(args.proxy)
    if not proxy:
        print(json.dumps({"ok": False, "error": "Invalid proxy format"}))
        sys.exit(1)

    try:
        from camoufox.sync_api import Camoufox
    except ImportError:
        try:
            from camoufox import Camoufox
        except ImportError:
            print(json.dumps({"ok": False, "error": "Camoufox not installed"}))
            sys.exit(1)

    result = {"ok": False, "server": proxy.get("server")}
    try:
        t0 = time.time()
        kwargs = dict(
            headless=args.headless,
            proxy=proxy,
            humanize=False,
        )
        with Camoufox(**kwargs) as browser:
            context = getattr(browser, "context", None) or browser
            page = context.new_page()
            page.goto("https://api.ipify.org?format=json", wait_until="domcontentloaded", timeout=20000)
            body = page.locator("body").inner_text(timeout=5000)
            info = json.loads(body)
            result["ok"] = True
            result["ip"] = info.get("ip")
            result["latency"] = round((time.time() - t0) * 1000)
    except Exception as e:
        result["error"] = str(e)[:300]

    print(json.dumps(result))

if __name__ == "__main__":
    main()
