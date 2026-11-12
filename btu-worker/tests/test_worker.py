import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import worker

class Tests(unittest.TestCase):
    def test_continuity(self):
        r = {"status":"success", "payload":{"render_status":"queued","wings":8,
             "prompt":"The original Demon God awakens", "character_reference":"local://projects/ref.png",
             "width":480,"height":832,"fps":24,"duration_seconds":3}}
        self.assertEqual(worker.eligible(r)["wings"], 8)
        r["payload"]["wings"] = 6
        with self.assertRaises(worker.Blocked):
            worker.eligible(r)

    def test_path_containment(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "projects").mkdir()
            (root / "projects/ref.png").write_bytes(b"test")
            self.assertEqual(worker.original_reference("local://projects/ref.png", root), root / "projects/ref.png")
            for path in ("local:///etc/passwd","local://../ref.png","local://projects/../../ref.png","https://host/ref.png"):
                with self.assertRaises(worker.Blocked):
                    worker.original_reference(path, root)

    def test_bindings(self):
        graph = {"6":{"inputs":{"text":"old"}}, "12":{"inputs":{"image":"old.png"}}}
        bindings = {"positive_prompt":{"node":"6","input":"text"},
                    "reference_image":{"node":"12","input":"image"}}
        updated = worker.graph_for(graph, bindings, "new prompt", "upload.png", "record")
        self.assertEqual(updated["6"]["inputs"]["text"], "new prompt")
        self.assertEqual(updated["12"]["inputs"]["image"], "upload.png")
        self.assertEqual(graph["6"]["inputs"]["text"], "old")
        with self.assertRaises(worker.Blocked):
            worker.graph_for(graph, {}, "x", "y", "record")

    def test_video_output(self):
        h = {"outputs":{"42":{"gifs":[{"filename":"shot.mp4","subfolder":"","type":"output"}]}}}
        self.assertEqual(worker.history_video(h)["filename"], "shot.mp4")
        with self.assertRaises(worker.Blocked):
            worker.history_video({"outputs":{"42":{"images":[{"filename":"still.png"}]}}})
        with self.assertRaises(worker.Blocked):
            worker.history_video({"outputs":{"42":{"videos":[{"filename":"../bad.mp4"}]}}})

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg unavailable")
    def test_real_ffprobe(self):
        with tempfile.TemporaryDirectory() as d:
            mp4 = Path(d) / "test.mp4"
            subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-y","-f","lavfi","-i",
                            "color=s=128x224:d=1:r=8","-c:v","mpeg4",str(mp4)],check=True)
            self.assertGreater(worker.probe(mp4,1), .9)
            with self.assertRaises(worker.Blocked):
                worker.probe(mp4,10)

    def test_cursor_and_idempotence(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            (root/"graph.json").write_text(json.dumps({"6":{"inputs":{"text":""}},"12":{"inputs":{"image":""}}}))
            (root/"bindings.json").write_text(json.dumps({"positive_prompt":{"node":"6","input":"text"},
                                                           "reference_image":{"node":"12","input":"image"}}))
            c=SimpleNamespace(queue=worker.QUEUE,comfy="http://127.0.0.1:8188",workflow=root/"graph.json",
                bindings=root/"bindings.json",state=root/"state.db",key="fake",output=root,assets=root,
                since="2026-10-29",limit=20,timeout=5)
            w=worker.Worker(c)
            record={"id":"abc","status":"success","payload":{"render_status":"queued","wings":8,
                "prompt":"Demon God original","character_reference":"local://projects/ref.png",
                "width":480,"height":832,"fps":24,"duration_seconds":3}}
            page={"data":[record],"pagination":{"poll_cursor":"next"}}
            with patch.object(worker,"request",return_value=page) as req, patch.object(w,"render",return_value=root/"abc.mp4") as render, patch.object(w,"update_verified") as update:
                self.assertEqual(w.cycle(),(False,1))
                self.assertEqual(w.cursor(),"next")
                self.assertEqual(w.cycle(),(False,1))
                render.assert_called_once()
                update.assert_called_once()
                self.assertIn("cursor=next",req.call_args.args[0])
            w.db.close()

if __name__=="__main__":
    unittest.main()
