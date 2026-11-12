import json
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parent
class ManifestTests(unittest.TestCase):
    def test_manifest(self):
        m=json.loads((ROOT/"shots.json").read_text())
        self.assertEqual(len(m["shots"]),12)
        self.assertEqual(sum(s["duration_seconds"] for s in m["shots"]),90)
        self.assertEqual(len(set(s["file"] for s in m["shots"])),12)
        self.assertEqual(m["render_status"],"NOT_RENDERED")
        self.assertEqual(m["format"],"9:16")
if __name__=="__main__": unittest.main()
