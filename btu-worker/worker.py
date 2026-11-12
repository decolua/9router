#!/usr/bin/env python3
"""BTU Cinema: authenticated 3Min sandbox queue to local ComfyUI video worker.

Requires real ComfyUI Wan I2V API workflow, original reference, and GPU weights.
"""
import argparse
import copy
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

QUEUE = "https://api.3minapi.com/api/v1/data/o8mxl7uhc7371qouz39de"

class Blocked(RuntimeError):
    pass

def request(url, token="", method="GET", body=None, timeout=30):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = "Bearer " + token
    with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=headers, method=method), timeout=timeout) as r:
        return json.load(r)

def validate_urls(queue, comfy):
    q, c = urllib.parse.urlsplit(queue), urllib.parse.urlsplit(comfy)
    if q.scheme != "https" or q.hostname != "api.3minapi.com":
        raise Blocked("Queue URL must be HTTPS on api.3minapi.com")
    if c.scheme != "http" or c.hostname not in ("127.0.0.1", "localhost", "::1"):
        raise Blocked("ComfyUI must be localhost; use a trusted SSH tunnel for remote GPU")

def original_reference(uri, root):
    if not isinstance(uri, str) or not uri.startswith("local://"):
        raise Blocked("Original character reference required")
    rel = urllib.parse.unquote(uri[8:])
    if not rel or rel.startswith("/") or "\\" in rel or any(x in ("", ".", "..") for x in rel.split("/")):
        raise Blocked("Unsafe character reference path")
    root = Path(root).resolve()
    path = (root / rel).resolve()
    if root not in path.parents or not path.is_file() or path.suffix.lower() not in (".png", ".jpg", ".jpeg", ".webp"):
        raise Blocked("Original reference file missing from asset root")
    return path

def eligible(record):
    if record.get("status") != "success" or not isinstance(record.get("payload"), dict):
        return None
    p = record["payload"]
    if p.get("render_status") != "queued":
        return None
    if p.get("wings") != 8 or not isinstance(p.get("prompt"), str) or len(p["prompt"].strip()) < 5:
        raise Blocked("Eight-wing continuity or prompt validation failed")
    if not isinstance(p.get("character_reference"), str):
        raise Blocked("Original reference required")
    for key in ("width", "height", "fps", "duration_seconds"):
        if type(p.get(key)) not in (float, int) or p[key] <= 0:
            raise Blocked("Invalid " + key)
    if p["width"] > 3840 or p["height"] > 3840 or p["fps"] > 120 or p["duration_seconds"] > 30:
        raise Blocked("Unsafe shot limits")
    return p

def graph_for(template, bindings, prompt, image, record_id):
    graph = copy.deepcopy(template)
    for name, value in (("positive_prompt", prompt), ("reference_image", image)):
        b = bindings.get(name)
        if not isinstance(b, dict) or not isinstance(b.get("node"), str) or not isinstance(b.get("input"), str):
            raise Blocked("Missing node binding: " + name)
        node = graph.get(b["node"], {})
        if b["input"] not in node.get("inputs", {}):
            raise Blocked("Missing ComfyUI input: " + name)
        node["inputs"][b["input"]] = value
    b = bindings.get("filename_prefix")
    if b:
        node = graph.get(b.get("node"), {})
        if b.get("input") not in node.get("inputs", {}):
            raise Blocked("Invalid output prefix binding")
        node["inputs"][b["input"]] = "btu_" + record_id.replace("-", "")
    return graph

def upload_image(comfy, path):
    if path.stat().st_size > 32 * 1024 * 1024:
        raise Blocked("Reference exceeds 32 MiB")
    boundary = "btu" + uuid.uuid4().hex
    mime = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}[path.suffix.lower()]
    safe_name = path.name.replace('"', "_").replace("\r", "_").replace("\n", "_")
    prefix = (f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="{safe_name}"\r\n'
              f'Content-Type: {mime}\r\n\r\n').encode()
    data = prefix + path.read_bytes() + (f"\r\n--{boundary}--\r\n").encode()
    req = urllib.request.Request(comfy + "/upload/image", data=data,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}, method="POST")
    with urllib.request.urlopen(req, timeout=60) as r:
        result = json.load(r)
    if not isinstance(result.get("name"), str) or not result["name"]:
        raise Blocked("ComfyUI image upload failed")
    return result["name"]

def history_video(history):
    for node in history.get("outputs", {}).values():
        for key in ("videos", "gifs", "video"):
            values = node.get(key, [])
            if isinstance(values, dict):
                values = [values]
            if not isinstance(values, list):
                continue
            for v in values:
                if not isinstance(v, dict):
                    continue
                name, sub = v.get("filename", ""), v.get("subfolder", "")
                if (isinstance(name, str) and name.lower().endswith(".mp4") and Path(name).name == name
                        and isinstance(sub, str) and not sub.startswith(("/", "\\"))
                        and not any(x in ("..", ".") for x in sub.replace("\\", "/").split("/"))
                        and v.get("type", "output") == "output"):
                    return {"filename": name, "subfolder": sub, "type": "output"}
    raise Blocked("ComfyUI history has no saved MP4 output")

def probe(path, target_seconds):
    if not shutil.which("ffprobe"):
        raise Blocked("ffprobe is required")
    p = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
        "format=duration:stream=codec_type,width,height", "-of", "json", str(path)],
        capture_output=True, text=True, timeout=30)
    if p.returncode:
        raise Blocked("ffprobe rejected MP4")
    info = json.loads(p.stdout)
    seconds = float(info.get("format", {}).get("duration", 0))
    if not any(s.get("codec_type") == "video" for s in info.get("streams", [])) or seconds < max(.5, target_seconds * .6):
        raise Blocked("Video missing or shorter than 60% of requested duration")
    return seconds

def download(comfy, desc, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".partial")
    try:
        total = 0
        with urllib.request.urlopen(comfy + "/view?" + urllib.parse.urlencode(desc), timeout=120) as r, tmp.open("wb") as out:
            while True:
                chunk = r.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > 512 * 1024 * 1024:
                    raise Blocked("Video download exceeds 512 MiB")
                out.write(chunk)
        if total < 1024:
            raise Blocked("ComfyUI returned empty output")
        tmp.replace(path)
    finally:
        tmp.unlink(missing_ok=True)

class Worker:
    def __init__(self, config):
        self.c = config
        validate_urls(config.queue, config.comfy)
        self.graph = json.loads(Path(config.workflow).read_text())
        self.bindings = json.loads(Path(config.bindings).read_text())
        graph_for(self.graph, self.bindings, "preflight", "reference.png", "preflight")
        self.db = sqlite3.connect(config.state)
        self.db.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        self.db.execute("CREATE TABLE IF NOT EXISTS done (id TEXT PRIMARY KEY, path TEXT NOT NULL)")
        self.db.commit()

    def cursor(self):
        row = self.db.execute("SELECT value FROM meta WHERE key='cursor'").fetchone()
        return row[0] if row else None

    def save_cursor(self, value):
        with self.db:
            self.db.execute("INSERT OR REPLACE INTO meta VALUES ('cursor',?)", (value,))

    def render(self, record, p):
        path = Path(self.c.output) / (record["id"] + ".mp4")
        if path.exists():
            try:
                probe(path, p["duration_seconds"])
                return path
            except Blocked:
                path.unlink()
        ref = original_reference(p["character_reference"], self.c.assets)
        image = upload_image(self.c.comfy, ref)
        graph = graph_for(self.graph, self.bindings, p["prompt"], image, record["id"])
        submission = request(self.c.comfy + "/prompt", method="POST",
                             body={"prompt": graph, "client_id": str(uuid.uuid4())})
        prompt_id = submission.get("prompt_id")
        if not prompt_id:
            raise Blocked("ComfyUI rejected workflow: " + str(submission.get("error", "unknown"))[:120])
        end = time.monotonic() + self.c.timeout
        while time.monotonic() < end:
            item = request(self.c.comfy + "/history/" + urllib.parse.quote(prompt_id)).get(prompt_id)
            if item:
                status = item.get("status", {})
                if status.get("status_str") == "error":
                    raise Blocked("ComfyUI render failed")
                if status.get("completed"):
                    download(self.c.comfy, history_video(item), path)
                    try:
                        probe(path, p["duration_seconds"])
                    except Exception:
                        path.unlink(missing_ok=True)
                        raise
                    return path
            time.sleep(5)
        raise Blocked("Render timed out; inspect ComfyUI history before retry")

    def update_verified(self, record, path):
        uri = "local://renders/" + path.name
        body = dict(record["payload"])
        body.update(render_status="rendered_local", output_uri=uri)
        url = self.c.queue + "/" + urllib.parse.quote(record["id"])
        request(url, token=self.c.key, method="PUT", body=body)
        # 3Min PUT returns 202 before persistence; verify the stored value.
        for _ in range(8):
            time.sleep(3)
            current = request(url, token=self.c.key).get("data", {}).get("payload", {})
            if current.get("render_status") == "rendered_local" and current.get("output_uri") == uri:
                return
        raise Blocked("3Min accepted update but read-back was not confirmed")

    def handle(self, record):
        if self.db.execute("SELECT 1 FROM done WHERE id=?", (record.get("id"),)).fetchone():
            return
        p = eligible(record)
        if p is None:
            return
        path = self.render(record, p)
        self.update_verified(record, path)
        with self.db:
            self.db.execute("INSERT OR REPLACE INTO done VALUES (?,?)", (record["id"], str(path)))
        print("Verified local MP4 shot:", record["id"], flush=True)

    def cycle(self):
        params = {"limit": self.c.limit}
        if self.cursor():
            params["cursor"] = self.cursor()
        elif self.c.since:
            params["since"] = self.c.since
        page = request(self.c.queue + "/poll?" + urllib.parse.urlencode(params), token=self.c.key)
        records = page.get("data")
        pagination = page.get("pagination", {})
        if not isinstance(records, list):
            raise Blocked("Malformed queue page")
        for record in records:
            self.handle(record)
        cursor = pagination.get("next_cursor") or pagination.get("poll_cursor")
        if not cursor:
            raise Blocked("Queue cursor absent; refusing to lose place")
        self.save_cursor(cursor)
        return bool(pagination.get("next_cursor")), len(records)

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    from types import SimpleNamespace
    c = SimpleNamespace(
        queue=os.getenv("BTU_QUEUE_URL", QUEUE).rstrip("/"),
        comfy=os.getenv("BTU_COMFY_URL", "http://127.0.0.1:8188").rstrip("/"),
        key=os.getenv("BTU_3MIN_API_KEY", ""),
        workflow=os.getenv("BTU_WORKFLOW_JSON", "wan22_api.json"),
        bindings=os.getenv("BTU_BINDINGS_JSON", "bindings.json"),
        assets=Path(os.getenv("BTU_ASSET_ROOT", "./assets")),
        output=Path(os.getenv("BTU_OUTPUT_ROOT", "./renders")),
        state=os.getenv("BTU_STATE_DB", "./worker-state.sqlite3"),
        since=os.getenv("BTU_SINCE", ""),
        limit=int(os.getenv("BTU_POLL_LIMIT", "20")),
        timeout=int(os.getenv("BTU_RENDER_TIMEOUT", "1800")),
        interval=max(60, int(os.getenv("BTU_POLL_SECONDS", "300"))))
    if not 1 <= c.limit <= 100:
        ap.error("BTU_POLL_LIMIT must be 1..100")
    validate_urls(c.queue, c.comfy)
    if args.check:
        graph_for(json.loads(Path(c.workflow).read_text()), json.loads(Path(c.bindings).read_text()),
                  "preflight", "reference.png", "preflight")
        print("Workflow bindings valid; GPU, weights, and rendering not verified")
        return
    if not c.key:
        ap.error("Set BTU_3MIN_API_KEY in environment, never in source code")
    w = Worker(c)
    while True:
        try:
            more, count = w.cycle()
            print("Processed queue page:", count, flush=True)
            if args.once:
                return
            if not more:
                time.sleep(c.interval)
        except (Blocked, urllib.error.URLError, TimeoutError) as e:
            print("Worker blocked:", type(e).__name__, str(e)[:200], file=sys.stderr, flush=True)
            if args.once:
                raise SystemExit(1)
            time.sleep(c.interval)

if __name__ == "__main__":
    main()
