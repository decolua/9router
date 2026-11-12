# BTU Cinema: self-hosted ComfyUI render worker (sandbox)

This is **source code, not a running GPU**. The worker connects the existing 3Min API sandbox record queue to an independently running ComfyUI instance. It does not bundle or install Wan 2.2 model weights, and it does not bypass provider credits.

## Required infrastructure

- A computer/server with a compatible GPU, installed ComfyUI, and legally obtained Wan 2.2 video workflow/checkpoints.
- A ComfyUI **API-format** workflow exported from the ComfyUI UI. It must contain an image loader and text-prompt node with editable inputs.image and inputs.text. The workflow must actually output a video (videos/gifs metadata with an MP4/WebM/MOV file).
- A local **original** Demon God reference image on that computer, e.g. references/projects/character_reference.png. This must be the approved character, not a newly generated substitute.
- A 3Min **sandbox** API key supplied in the process environment. Never commit keys or private reference files.

The existing 3Min endpoint is a data queue only. It does not render videos. No worker was registered when this integration was written.

## Run

From the repository's demon-god-episode2 directory:

~~~bash
export BTU_3MIN_API_KEY='tm_test_...'
python comfyui_queue_worker.py \
  --workflow /absolute/path/to/wan22_api_workflow.json \
  --prompt-node 6 --image-node 10 \
  --reference-root /absolute/path/to/references \
  --output-root /absolute/path/to/renders \
  --state-file /absolute/path/to/private/btu-poll-cursor.json \
  --comfy-url http://127.0.0.1:8188 \
  --since 2026-10-29 --loop
~~~

Change 6 and 10 to the actual node IDs in your exported workflow. The image loader must influence the video generation pipeline; merely having an unconnected image loader does not preserve identity. For each queued job, the worker resolves local://projects/character_reference.png relative to --reference-root, uploads it to ComfyUI, patches the API workflow, submits a prompt, waits for completion, downloads the output and checks its duration and dimensions with ffprobe.

A job with wings != 8, missing reference, unsupported dimensions, no actual video, or a failed ComfyUI workflow is not marked completed. The worker leaves the job queued and does not advance its 3Min polling cursor; it can retry after the missing reference, model or GPU is installed. The worker saves the cursor only after successful processing of the page and a confirmed 3Min record update read-back. The API may delay new records by ~60 seconds; --interval 300 reduces polling quota use. The --since flag recovers the existing sandbox job on the first run only. Once the state file contains a cursor, the cursor takes precedence; do not delete the state file to force a replay.

A successfully rendered file is marked rendered_local with an empty output_uri. It is a **worker-local shot only**. The worker deliberately does not mark a job completed or advertise a public URL without an independently verified delivery and playback path. Serving files to Android requires a separate authenticated file transfer or server.

## Limits and safety

- Sandbox only. The program refuses keys that do not begin tm_test_. No production deployment is performed.
- Uses the **existing** 3Min queue endpoint. No new paid service, provider or cloud GPU is provisioned.
- The worker is deliberately single-process. Run only one consumer for the same cursor/state file; concurrent consumers can duplicate renders.
- Current queue example requests a 640x360, 3-second test, not the 1080x1920 90-second final episode. Use the shot manifest to submit correctly sized individual scene jobs once a GPU is available.
- The script accepts a pre-existing API workflow but does not guarantee compatibility with any particular Wan 2.2 checkpoint, node pack, or GPU. Test the actual exported workflow before processing the queue.
- A ComfyUI timeout can leave a remote job running. Inspect ComfyUI history before resubmitting.
- The queue cursor should be backed up. Records are processed only if render_status is queued; replaying a previously updated record does not re-render it.
- No generated file is considered a finished episode until **all** required shots are verified and assemble.py successfully assembles the complete output.

## Tests

~~~bash
python -m unittest discover -p 'test_*.py' -v
~~~

The existing GitHub Actions episode-assembly test workflow also discovers the new tests. FFmpeg and ffprobe are installed in that workflow.
