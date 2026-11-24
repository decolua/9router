# BTU Cinema GPU Worker: 3Min + ComfyUI Wan 2.2

This is a **real worker implementation**, not a GPU deployment. It polls the existing BTU Cinema Render Jobs **sandbox** queue, supplies the **original character reference** and prompt to an installed ComfyUI **API-format** Wan 2.2 image-to-video graph, waits for an actual saved MP4, checks its video stream and duration with FFprobe, then updates the original 3Min record. No fake inference, fake MP4 or generic replacement character.

## Requirements

- Python 3.10+, ffprobe, a real ComfyUI server on localhost or through a trusted SSH tunnel, a compatible GPU and Wan 2.2 I2V checkpoints.
- Export a working **API-format** I2V workflow from ComfyUI. Ordinary canvas JSON is not the API graph. Ensure it has a LoadImage input, positive prompt input and a SaveVideo/VideoCombine node that writes an MP4.
- The original reference must be installed at assets/projects/character_reference.png to match the existing sandbox job's local://projects/character_reference.png. Do not use a substitute identity.
- Set a 3Min sandbox key with read/update permissions in the environment. Never commit tokens or private character assets.

See the official [ComfyUI Wan 2.2 I2V workflow](https://comfy.org/fr/workflows/gsl_starter_1_2-558dc01ae546/) for model component names and setup. Download checkpoints only from trusted sources and check licenses and actual GPU VRAM requirements.

## Run

~~~bash
cd btu-worker
cp bindings.example.json bindings.json
# Copy the real ComfyUI API-exported workflow to wan22_api.json
# Change bindings.json node IDs and input names to match your graph.
export BTU_3MIN_API_KEY='YOUR_SANDBOX_KEY'
export BTU_WORKFLOW_JSON="$PWD/wan22_api.json"
export BTU_BINDINGS_JSON="$PWD/bindings.json"
export BTU_ASSET_ROOT="$PWD/assets"
export BTU_OUTPUT_ROOT="$PWD/renders"
export BTU_STATE_DB="$PWD/worker-state.sqlite3"
export BTU_SINCE='2026-10-29'   # first run only, to include existing sandbox job
python worker.py --check       # workflow mapping only, no inference
python worker.py --once        # one page, real inference if ready
python worker.py               # loop, default 5-minute interval
~~~

BTU_COMFY_URL defaults to http://127.0.0.1:8188; use an SSH tunnel for a remote GPU. BTU_QUEUE_URL defaults to the existing sandbox queue URL and is restricted to HTTPS on api.3minapi.com. Set BTU_POLL_SECONDS to change the interval (minimum 60 seconds). Each poll consumes a 3Min read call, including empty polls. 3Min may delay newly created records by ~60 seconds. Only **one worker instance** should poll this queue. SQLite stores its cursor and completed record IDs.

### Workflow bindings

The bindings.example.json contains **placeholder node IDs**. Edit them for the installed ComfyUI graph. positive_prompt and reference_image are mandatory, filename_prefix optional. If the original image is unavailable, the job is blocked rather than rendered with a substitute. The worker only processes queued records with wings=8, valid positive shot dimensions, fps and duration.

### Output and verification

ComfyUI must return a real MP4 in /history/{prompt_id} (under videos, gifs, or video); the worker downloads it via /view, validates it with ffprobe, then performs a **read-back** after the asynchronous 3Min PUT. Only then does it record render_status=rendered_local and output_uri=local://renders/<record-id>.mp4.

**rendered_local is a verified worker-local shot, not a complete episode and not a public/Android-accessible URL.** After all shots are rendered, use demon-god-episode2/assemble.py to assemble and separately verify the full film. A file server or authenticated transfer is still needed to move shots to Android.

Failures do not advance the queue cursor; the worker retries after the configured interval. Inspect the logged cause, install missing assets/weights, or fix the graph. No production deployment, provider charges or credential bypass is performed.

### Tests

~~~bash
python -m unittest discover -s tests -v
~~~

The offline tests verify continuity guards, path containment, node mappings, video output selection, real FFprobe checks, and queue cursor/idempotency behavior. They do not prove GPU inference.
