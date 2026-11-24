import unittest,importlib.util,pathlib,tomllib
BASE=pathlib.Path(__file__).resolve().parents[1]
class B200SourceTests(unittest.TestCase):
    def test_configuration(self):
        d=tomllib.loads((BASE/"cerebrium.toml").read_text())["cerebrium"]
        self.assertEqual(d["hardware"]["compute"],"BLACKWELL_B200")
        self.assertFalse(d["deployment"]["disable_auth"])
        self.assertEqual(d["scaling"]["min_replicas"],0)
        self.assertEqual(d["scaling"]["max_replicas"],1)
    def test_model_and_cuda(self):
        src=(BASE/"main.py").read_text()
        self.assertIn("Qwen/Qwen-Image-2512",src)
        self.assertIn("torch.cuda.is_available()",src)
        self.assertNotIn("data:image",src)
    def test_output_schema(self):
        src=(BASE/"main.py").read_text()
        for name in ["image_base64","mime_type","width","height","gpu","model","model_ready"]:
            self.assertIn(name,src)
    def test_health_schema_without_gpu(self):
        spec=importlib.util.spec_from_file_location("worker",BASE/"main.py")
        import sys
        sys.path.insert(0,str(BASE))
        module=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        d=module.health()
        self.assertEqual(d["service"],"sceneforge-gpu")
        self.assertFalse(d["model_ready"])
        self.assertEqual(d["model"],"Qwen/Qwen-Image-2512")
if __name__=="__main__":unittest.main()
