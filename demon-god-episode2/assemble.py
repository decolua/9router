#!/usr/bin/env python3
"""Normalize and assemble real rendered shots; refuse missing or invalid footage."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

def ffprobe(path):
    p = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
        "format=duration:stream=codec_type,width,height,r_frame_rate", "-of", "json", str(path)],
        capture_output=True, text=True, check=True)
    data = json.loads(p.stdout)
    video = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), None)
    if not video:
        raise ValueError(f"Missing video stream: {path}")
    return float(data.get("format", {}).get("duration", 0)), video, any(s.get("codec_type") == "audio" for s in data.get("streams", []))

def safe_input(root, relative):
    if not isinstance(relative, str) or not relative or Path(relative).is_absolute():
        raise ValueError("Shot path must be relative")
    path = (root / relative).resolve()
    if root not in path.parents or not path.is_file():
        raise FileNotFoundError(f"Missing or unsafe rendered shot: {relative}")
    return path

def run(cmd):
    subprocess.run(cmd, check=True, capture_output=True, text=True)

def normalize(source, destination, duration, width, height, fps, has_audio):
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(source)]
    if not has_audio:
        cmd += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
    vf = (f"fps={fps},scale={width}:{height}:force_original_aspect_ratio=decrease,"
          f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1")
    cmd += ["-map", "0:v:0", "-map", "0:a:0" if has_audio else "1:a:0", "-vf", vf,
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
            "-r", str(fps), "-c:a", "aac", "-ar", "48000", "-ac", "2", "-af", "apad",
            "-t", str(duration), "-movflags", "+faststart", str(destination)]
    run(cmd)
    got, stream, audio = ffprobe(destination)
    if abs(got - duration) > 0.4 or stream["width"] != width or stream["height"] != height or not audio:
        raise ValueError(f"Normalization failed: {source}, duration {got:.3f} vs {duration}")

def assemble(manifest_path, output):
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise RuntimeError("Install FFmpeg and ffprobe first")
    root = manifest_path.resolve().parent
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    width, height, fps = (int(manifest[k]) for k in ("width", "height", "fps"))
    if not (0 < width <= 3840 and 0 < height <= 3840 and 0 < fps <= 120 and width % 2 == 0 and height % 2 == 0):
        raise ValueError("Invalid output dimensions/fps")
    shots = manifest.get("shots")
    if not isinstance(shots, list) or not shots:
        raise ValueError("Manifest has no shots")
    sources = []
    expected = 0
    for shot in shots:
        path = safe_input(root, shot.get("file"))
        target = float(shot.get("duration_seconds", 0))
        if not 0.2 <= target <= 120:
            raise ValueError(f"Invalid target duration: {path}")
        duration, _, has_audio = ffprobe(path)
        if duration < target - 0.4:
            raise ValueError(f"Rendered shot is too short: {path} ({duration:.2f}s vs {target}s)")
        sources.append((path, target, has_audio))
        expected += target
    output = output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    if any(output == path for path, _, _ in sources):
        raise ValueError("Output must not overwrite an original shot")
    with tempfile.TemporaryDirectory(prefix="btu-assembly-") as td:
        tmp = Path(td)
        normalized = []
        for i, (source, duration, has_audio) in enumerate(sources, 1):
            dest = tmp / f"shot_{i:03d}.mp4"
            normalize(source, dest, duration, width, height, fps, has_audio)
            normalized.append(dest)
        listing = tmp / "concat.txt"
        def esc(path):
            return str(path).replace("'", "'\\''")
        listing.write_text("".join("file '" + esc(path) + "'\n" for path in normalized), encoding="utf-8")
        staged = tmp / "episode.mp4"
        run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0",
             "-i", str(listing), "-c", "copy", "-movflags", "+faststart", str(staged)])
        final_duration, stream, audio = ffprobe(staged)
        if abs(final_duration - expected) > max(0.6, len(shots) * 0.08) or not audio or stream["width"] != width or stream["height"] != height:
            raise ValueError(f"Final episode failed validation: duration {final_duration:.2f}s vs {expected:.2f}s")
        shutil.copyfile(staged, output.with_suffix(output.suffix + ".partial"))
        output.with_suffix(output.suffix + ".partial").replace(output)
    print(json.dumps({"output": str(output), "status": "VERIFIED_ASSEMBLED", "duration_seconds": final_duration,
                      "width": width, "height": height, "fps": fps, "audio_stream": True}, indent=2))

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", type=Path, default=Path(__file__).with_name("shots.json"))
    ap.add_argument("--output", type=Path, default=Path("output/episode2.mp4"))
    args = ap.parse_args()
    assemble(args.manifest, args.output)
