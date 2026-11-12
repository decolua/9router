import http.server,json,threading,unittest
from agent01 import validate_url,probe,run_task
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def response(self,content):
        assert self.headers["Authorization"]=="Bearer test-key"
        b=json.dumps(content).encode()
        self.send_response(200)
        self.send_header("Content-Length",str(len(b)))
        self.end_headers();self.wfile.write(b)
    def do_GET(self): self.response({"data":[{"id":"fixture"}]})
    def do_POST(self):
        body=json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        assert body["model"]=="auto"
        assert body["messages"][0]["role"]=="system"
        self.response({"choices":[{"message":{"content":"Fixture response"}}]})
class Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server=http.server.ThreadingHTTPServer(("127.0.0.1",0),Handler)
        cls.worker=threading.Thread(target=cls.server.serve_forever,daemon=True)
        cls.worker.start()
        cls.url="http://127.0.0.1:"+str(cls.server.server_port)
    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
    def test_probe(self): self.assertEqual(probe(self.url,"test-key")["models"],1)
    def test_run(self): self.assertEqual(run_task(self.url,"test-key","Plan"),"Fixture response")
    def test_http_denied(self):
        with self.assertRaises(ValueError): validate_url("http://example.com")
    def test_private_address_denied(self):
        with self.assertRaises(ValueError): validate_url("http://10.0.0.1")
    def test_credentials_denied(self):
        with self.assertRaises(ValueError): validate_url("https://alice:secret@example.com")
    def test_invalid_endpoint_denied(self):
        with self.assertRaises(ValueError): validate_url("https://example.com/admin")
    def test_missing_key(self):
        with self.assertRaises(ValueError): probe(self.url,"")
    def test_empty_task(self):
        with self.assertRaises(ValueError): run_task(self.url,"test-key","")
if __name__=="__main__": unittest.main()
