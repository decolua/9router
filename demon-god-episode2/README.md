# The Demon God's Awakening: Episode 2

An original dark-fantasy short-film production package, independent of NexusRemote and the 9router application.

## Story
An ancient but youthful Demon God opens his eyes in the sealed Obsidian Citadel. He rises, breaks the gate seals, and releases a shockwave across the demon kingdoms. Every general bows. In Heaven, two six-winged sentinels feel fear for the first time. Final line: **"Let the heavens remember my name."**

**Format:** vertical 9:16, 90 seconds, target 24 fps, target 1080×1920. These are *delivery targets*, not proof of rendered output.

## Build
The manifest in `shots.json` is the complete 12-shot episode, with timing, dialogue, visual descriptions, continuity, and model preferences. The `assemble.py` script concatenates **already-rendered** shots and checks every clip with `ffprobe`. It refuses to invent missing footage or claim that a text-to-video job succeeded.

1. Install FFmpeg and Python 3.10+.
2. Generate each shot through an authorized local installation of Wan 2.2, LTX, FramePack, Open-Sora or HunyuanVideo. Video weights, actual VRAM and compatible workflows are required.
3. Save shots at `renders/shot_01.mp4` through `renders/shot_12.mp4`, with matching orientation and frame rate.
4. Run `python assemble.py --manifest shots.json --output output/episode2.mp4`.
5. Inspect the final video and audio. Add finished music / sound as licensed recordings in your editor; this package does not include protected audio or a pretrained video model.

### Honest rendering state
This GitHub package includes source files and a production plan, not an already-generated 90-second movie. Free/open source software still requires a working GPU or host. The earlier 56-second stylized MP4 from chat is a separate preview and is not included in this repository.

### Rights
The writing and episode prompts are original. Verify licenses of chosen model checkpoints, music, voices and any imported reference images before distributing the film.
