import json
import shutil
import subprocess
import tempfile
from pathlib import Path
import unittest
import assemble

@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg required")
class AssemblyTests(unittest.TestCase):
    def test_mixed_sources_normalized_and_audio_added(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            a, b = root / "a.mp4", root / "b.mp4"
            subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                "color=s=160x90:r=8:d=1", "-c:v", "mpeg4", str(a)], check=True)
            subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                "color=s=96x144:r=12:d=1", "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
                "-c:v", "mpeg4", "-c:a", "aac", str(b)], check=True)
            manifest = {"width":128, "height":224, "fps":12, "shots":[
                {"file":"a.mp4", "duration_seconds":1}, {"file":"b.mp4", "duration_seconds":1}]}
            (root / "shots.json").write_text(json.dumps(manifest))
            output = root / "final.mp4"
            assemble.assemble(root / "shots.json", output)
            seconds, video, audio = assemble.ffprobe(output)
            self.assertAlmostEqual(seconds, 2, delta=.3)
            self.assertEqual((video["width"], video["height"]), (128, 224))
            self.assertTrue(audio)

    def test_missing_source_refused(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "shots.json").write_text(json.dumps({"width":128, "height":224, "fps":12,
                "shots":[{"file":"missing.mp4", "duration_seconds":1}]}))
            with self.assertRaises(FileNotFoundError):
                assemble.assemble(root / "shots.json", root / "final.mp4")

if __name__ == "__main__":
    unittest.main()
