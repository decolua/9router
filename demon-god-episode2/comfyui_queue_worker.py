#!/usr/bin/env python3
"""BTU Cinema 3Min sandbox queue -> self-hosted ComfyUI video worker.

No inference happens unless a real ComfyUI server, installed workflow/models,
local original character image, and 3Min sandbox key are configured.
"""
import argparse
import copy
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

DEFAULT_API = "https://api.3minapi.com/api/v1/data/o8mxl7uhc7371qouz39de"


def request_json(url, *, method="GET", payload=None, token=None, timeout=30):
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def safe_local_reference(root, value):
    if not isinstance(value, str) or not value.startswith("local://"):
        raise ValueError("Original character reference must be a local:// path")
    relative = value[len("local://"):]
    path = (root.resolve() / relative).resolve()
    if root.resolve() not in path.parents or not path.is_file():
        raise FileNotFoundError("Original reference missing or outside reference root")
    if path.suffix.lower() not in (".png", ".jpg", ".jpeg", ".webp"):
        raise ValueError("Reference must be PNG, JPEG, or WebP")
    return path


def upload_image(comfy_url, path):
    boundary = "btu-" + uuid.uuid4().hex
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; "
        f"filename=\"{path.name}\"\r\nContent-Type: application/octet-stream\r\n\r\n"
    ).encode() + path.read_bytes() + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        comfy_url.rstrip("/") + "/upload/image", data=body, method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        result = json.loads(resp.read())
    name = result.get("name")
    if not isinstance(name, str) or not name:
        raise ValueError("ComfyUI did not return an uploaded image name")
    return name


def prepare_workflow(template, prompt_node, image_node, prompt, image_name):
    workflow = copy.deepcopy(template)
    for node_id, field, value in (
        (prompt_node, "text", prompt), (image_node, "image", image_name)
    ):
        node = workflow.get(str(node_id))
        if not isinstance(node, dict) or not isinstance(node.get("inputs"), dict):
            raise ValueError(f"Missing ComfyUI API workflow node: {node_id}")
        if field not in node["inputs"]:
            raise ValueError(f"Node {node_id} lacks required {field} input")
        node["inputs"][field] = value
    return workflow


def find_video_output(history):
    for output in history.get("outputs", {}).values():
        for key in ("videos", "gifs"):
            for entry in output.get(key, []):
                if isinstance(entry, dict) and str(entry.get("filename", "")).lower().endswith(
                    (".mp4", ".webm", ".mov")
                ):
                    return entry
    raise ValueError("ComfyUI finished without a video output; images are not an episode")


def download_video(comfy_url, entry, destination):
    params = urllib.parse.urlencode({
        "filename": entry["filename"], "subfolder": entry.get("subfolder", ""),
        "type": entry.get("type", "output")
    })
    req = urllib.request.Request(comfy_url.rstrip("/") + "/view?" + params)
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_suffix(destination.suffix + ".partial")
    try:
        with urllib.request.urlopen(req, timeout=120) as resp, partial.open("wb") as out:
            while True:
                chunk = resp.read(1024 * 1024)
                if not chunk:
                    break
                out.write(chunk)
        if partial.stat().st_size == 0:
            raise ValueError("Empty ComfyUI video download")
        partial.replace(destination)
    finally:
        partial.unlink(missing_ok=True)


def verify_video(path, *, min_seconds, width, height):
    if not path.is_file():
        raise FileNotFoundError(path)
    proc = subprocess.run([
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration:stream=codec_type,width,height", "-of", "json", str(path)
    ], capture_output=True, text=True, check=True)
    metadata = json.loads(proc.stdout)
    video = next((s for s in metadata.get("streams", [])
                  if s.get("codec_type") == "video"), None)
    duration = float(metadata.get("format", {}).get("duration", 0))
    if not video or duration < min_seconds - 0.4:
        raise ValueError("Video missing or shorter than requested duration")
    if video.get("width") != width or video.get("height") != height:
        raise ValueError("Video dimensions differ from queued render settings")
    return duration


def render_job(job, *, comfy_url, template, prompt_node, image_node,
               reference_root, output_root, timeout):
    payload = job["payload"]
    if payload.get("wings") != 8:
        raise ValueError("Eight-wing continuity gate rejected job")
    prompt = payload.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("Missing scene prompt")
    width, height = int(payload["width"]), int(payload["height"])
    duration = float(payload["duration_seconds"])
    if width < 64 or height < 64 or width > 3840 or height > 3840 or duration <= 0:
        raise ValueError("Invalid requested video dimensions or duration")
    project = re.sub(r"[^a-zA-Z0-9_-]+", "_", str(payload.get("project_id", "project")))[:64]
    scene = re.sub(r"[^a-zA-Z0-9_-]+", "_", str(payload.get("scene_id", job["id"])))[:64]
    destination = output_root / project / (scene + ".mp4")
    if destination.exists():
        verify_video(destination, min_seconds=duration, width=width, height=height)
        return destination
    reference = safe_local_reference(reference_root, payload.get("character_reference"))
    uploaded = upload_image(comfy_url, reference)
    workflow = prepare_workflow(template, prompt_node, image_node, prompt, uploaded)
    result = request_json(comfy_url.rstrip("/") + "/prompt", method="POST",
                          payload={"prompt": workflow, "client_id": "btu-" + uuid.uuid4().hex})
    prompt_id = result.get("prompt_id")
    if not prompt_id:
        raise ValueError(f"ComfyUI rejected workflow: {result.get('node_errors', result)}")
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        history = request_json(comfy_url.rstrip("/") + "/history/" + urllib.parse.quote(prompt_id))
        entry = history.get(prompt_id)
        if entry:
            status = entry.get("status", {})
            if status.get("status_str") == "error":
                raise RuntimeError("ComfyUI execution failed")
            if status.get("completed") or entry.get("outputs"):
                video_entry = find_video_output(entry)
                download_video(comfy_url, video_entry, destination)
                try:
                    verify_video(destination, min_seconds=duration, width=width, height=height)
                except (ValueError, FileNotFoundError, subprocess.CalledProcessError):
                    destination.unlink(missing_ok=True)  # invalid clip must not block retries
                    raise
                return destination
        time.sleep(5)
    raise TimeoutError("ComfyUI render timed out; inspect server history before retrying")


def process_record(job, *, api, token, config):
    if job.get("status") != "success" or job.get("payload", {}).get("render_status") != "queued":
        return
    payload = job["payload"].copy()
    try:
        path = render_job(job, **config)
    except (ValueError, FileNotFoundError, TimeoutError, RuntimeError,
            urllib.error.URLError, subprocess.CalledProcessError) as exc:
        print(f"Render not completed for {job['id']}: {type(exc).__name__}: {exc}", flush=True)
        # Do not update the record or advance the poll cursor. A missing GPU,
        # reference image or temporary failure can be fixed and retried.
        raise
    # A worker-local file is not an Android-accessible or public episode.
    payload.update(render_status="rendered_local", output_uri="")
    record_url = api.rstrip("/") + "/" + urllib.parse.quote(job["id"])
    request_json(record_url, method="PUT", payload=payload, token=token)
    # 3Min PUT is asynchronous (202); do not advance the cursor until
    # the updated record is actually readable with the expected status.
    for attempt in range(8):
        if attempt:
            time.sleep(2)
        current = request_json(record_url, token=token)
        stored = current.get("data", {}).get("payload", {})
        if stored.get("render_status") == "rendered_local" and stored.get("output_uri") == "":
            return
    raise RuntimeError("3Min update not confirmed; retain cursor and retry")

def poll_once(*, api, token, cursor, config, since=None):
    params = {"limit": 30}
    if cursor:
        params["cursor"] = cursor
    elif since:
        params["since"] = since
    response = request_json(api.rstrip("/") + "/poll?" + urllib.parse.urlencode(params), token=token)
    # The REST response shape is {data:[records], pagination:{...}}.
    for job in response.get("data", []):
        process_record(job, api=api, token=token, config=config)
    page = response.get("pagination", {})
    new_cursor = page.get("next_cursor") or page.get("poll_cursor")
    if not new_cursor:
        raise ValueError("3Min poll returned no cursor; refusing to advance checkpoint")
    return new_cursor, bool(page.get("next_cursor"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workflow", required=True, type=Path, help="Exported ComfyUI API-format JSON")
    parser.add_argument("--prompt-node", required=True, help="Node ID with inputs.text")
    parser.add_argument("--image-node", required=True, help="LoadImage node ID with inputs.image")
    parser.add_argument("--reference-root", required=True, type=Path)
    parser.add_argument("--output-root", required=True, type=Path)
    parser.add_argument("--state-file", type=Path, default=Path(".btu-poll-cursor.json"))
    parser.add_argument("--comfy-url", default="http://127.0.0.1:8188")
    parser.add_argument("--api", default=DEFAULT_API)
    parser.add_argument("--timeout", type=int, default=1800)
    parser.add_argument("--interval", type=int, default=300)
    parser.add_argument("--loop", action="store_true")
    parser.add_argument("--since", help="UTC YYYY-MM-DD on first poll only; ignored once cursor exists")
    args = parser.parse_args()
    token = os.environ.get("BTU_3MIN_API_KEY", "")
    if not token.startswith("tm_test_"):
        parser.error("BTU_3MIN_API_KEY must be the sandbox key; production disabled")
    if args.interval < 60 or args.timeout < 60:
        parser.error("interval and timeout must be >= 60 seconds")
    if not args.reference_root.is_dir():
        parser.error("reference-root does not exist")
    template = json.loads(args.workflow.read_text(encoding="utf-8"))
    config = dict(comfy_url=args.comfy_url, template=template,
                  prompt_node=args.prompt_node, image_node=args.image_node,
                  reference_root=args.reference_root.resolve(),
                  output_root=args.output_root.resolve(), timeout=args.timeout)
    while True:
        state = json.loads(args.state_file.read_text()) if args.state_file.exists() else {}
        cursor, has_more = poll_once(api=args.api, token=token, cursor=state.get("cursor"), config=config, since=args.since)
        args.state_file.parent.mkdir(parents=True, exist_ok=True)
        temp = args.state_file.with_suffix(".tmp")
        temp.write_text(json.dumps({"cursor": cursor}), encoding="utf-8")
        temp.replace(args.state_file)
        if not has_more:
            if not args.loop:
                break
            time.sleep(args.interval)


if __name__ == "__main__":
    main()
