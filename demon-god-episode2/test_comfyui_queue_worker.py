import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import comfyui_queue_worker as worker


class WorkerTests(unittest.TestCase):
    def test_reference_must_exist_under_root(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "original.png").write_bytes(b"image-placeholder")
            self.assertEqual(worker.safe_local_reference(root, "local://original.png"),
                             root / "original.png")
            with self.assertRaises((FileNotFoundError, ValueError)):
                worker.safe_local_reference(root, "local://../secret.png")
            with self.assertRaises(ValueError):
                worker.safe_local_reference(root, "https://example.org/image.png")

    def test_workflow_edits_copy_not_original(self):
        source = {"1": {"inputs": {"text": "old"}},
                  "2": {"inputs": {"image": "old.png"}}}
        changed = worker.prepare_workflow(source, "1", "2", "new prompt", "reference.png")
        self.assertEqual(changed["1"]["inputs"]["text"], "new prompt")
        self.assertEqual(changed["2"]["inputs"]["image"], "reference.png")
        self.assertEqual(source["1"]["inputs"]["text"], "old")
        with self.assertRaises(ValueError):
            worker.prepare_workflow(source, "3", "2", "new", "reference.png")

    def test_image_outputs_are_not_mistaken_for_video(self):
        with self.assertRaises(ValueError):
            worker.find_video_output({"outputs": {"8": {
                "images": [{"filename": "frame.png"}]}}})
        item = {"filename": "episode.mp4", "subfolder": "btu", "type": "output"}
        self.assertEqual(worker.find_video_output({"outputs": {"8": {
            "videos": [item]}}}), item)

    def test_nonqueued_record_never_renders(self):
        job = {"id": "a", "status": "success", "payload": {"render_status": "completed"}}
        with patch.object(worker, "render_job") as render:
            worker.process_record(job, api="https://example.test", token="test", config={})
            render.assert_not_called()

    def test_verified_local_render_not_misreported_as_public(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            destination = root / "project" / "scene.mp4"
            destination.parent.mkdir(parents=True)
            destination.write_bytes(b"verified-by-render-job-mock")
            job = {"id": "record", "status": "success", "payload": {
                "render_status": "queued", "project_id": "project", "scene_id": "scene",
                "wings": 8, "output_uri": ""}}
            config = {"output_root": root}
            with patch.object(worker, "render_job", return_value=destination), \
                 patch.object(worker, "request_json", side_effect=[{}, {"data": {"payload": {"render_status": "rendered_local", "output_uri": ""}}}]) as req, \
                 patch.dict(os.environ, {"BTU_OUTPUT_BASE_URL": ""}):
                worker.process_record(job, api="https://api.example.test", token="test", config=config)
            updated = req.call_args_list[0].kwargs["payload"]
            self.assertEqual(updated["render_status"], "rendered_local")
            self.assertEqual(updated["output_uri"], "")

    def test_poll_checkpoint_requires_server_cursor(self):
        with patch.object(worker, "request_json", return_value={"data": [], "pagination": {}}):
            with self.assertRaises(ValueError):
                worker.poll_once(api="https://example.test", token="test", cursor=None, config={})

    def test_poll_cursor_and_queued_dispatch(self):
        with patch.object(worker, "request_json", return_value={
            "data": [{"id": "a", "status": "success", "payload": {"render_status": "queued"}}],
            "pagination": {"poll_cursor": "cursor-2"}}), \
             patch.object(worker, "process_record") as process:
            cursor, more = worker.poll_once(api="https://example.test", token="test",
                                            cursor="cursor-1", config={})
            self.assertEqual(cursor, "cursor-2")
            self.assertFalse(more)
            process.assert_called_once()

    def test_readback_failure_keeps_job_unconfirmed(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            destination = root / "scene.mp4"
            destination.write_bytes(b"mock-output")
            job = {"id": "record", "status": "success",
                   "payload": {"render_status": "queued", "wings": 8}}
            with patch.object(worker, "render_job", return_value=destination), \
                 patch.object(worker, "request_json", return_value={"data": {"payload": {
                     "render_status": "queued"}}}), \
                 patch.object(worker.time, "sleep"):
                with self.assertRaises(RuntimeError):
                    worker.process_record(job, api="https://example.test", token="test",
                                          config={"output_root": root})

    def test_first_poll_since_and_existing_cursor_precedence(self):
        response = {"data": [], "pagination": {"poll_cursor": "new-cursor"}}
        with patch.object(worker, "request_json", return_value=response) as api:
            worker.poll_once(api="https://example.test", token="test", cursor=None,
                             config={}, since="2026-10-29")
            self.assertIn("since=2026-10-29", api.call_args.args[0])
            worker.poll_once(api="https://example.test", token="test", cursor="old-cursor",
                             config={}, since="2026-10-29")
            self.assertIn("cursor=old-cursor", api.call_args.args[0])
            self.assertNotIn("since=", api.call_args.args[0])

    def test_render_failure_does_not_advance_cursor_or_update_queue(self):
        queued = {"id": "record", "status": "success",
                  "payload": {"render_status": "queued", "wings": 8}}
        response = {"data": [queued], "pagination": {"poll_cursor": "cursor-2"}}
        with patch.object(worker, "request_json", return_value=response) as api, \
             patch.object(worker, "render_job", side_effect=FileNotFoundError("original image missing")):
            with self.assertRaises(FileNotFoundError):
                worker.poll_once(api="https://example.test", token="test",
                                 cursor="cursor-1", config={})
        self.assertEqual(api.call_count, 1)  # no PUT and no returned cursor

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg required")
    def test_probe_rejects_short_or_wrong_size(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "test.mp4"
            subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                "-f", "lavfi", "-i", "color=s=128x224:r=12:d=1",
                "-c:v", "mpeg4", str(path)], check=True)
            self.assertGreater(worker.verify_video(path, min_seconds=1,
                                                     width=128, height=224), .9)
            with self.assertRaises(ValueError):
                worker.verify_video(path, min_seconds=2, width=128, height=224)
            with self.assertRaises(ValueError):
                worker.verify_video(path, min_seconds=1, width=224, height=128)


if __name__ == "__main__":
    unittest.main()
