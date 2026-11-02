"""划词术语解释接口测试（关键词系统 P0）：/api/ai/term 的路由、校验、缓存与守卫。"""

import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

APP = Path(__file__).resolve().parents[1]

TERM_COMPLETION = json.dumps({"choices": [{"message": {"content": json.dumps({
    "one_liner": "把文本转成向量，语义相近则向量相近。",
    "analogy": "像给每段文字发一张可比较的“语义身份证”。",
    "use_case": "知识库问答先对文档与问题做 Embedding，再入向量库检索。",
    "confusable": ["Embedding vs 分词：向量化 vs 切词"],
    "exam_tip": "向量相近≈语义相近，不是字面相近。",
}, ensure_ascii=False)}}]}, ensure_ascii=False)


class MockUpstream(BaseHTTPRequestHandler):
    call_count = 0

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        self.rfile.read(length)
        MockUpstream.call_count += 1
        body = TERM_COMPLETION.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def post(port, payload, origin=None):
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/api/ai/term",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Origin": origin or f"http://127.0.0.1:{port}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


class TermAPITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        upstream = HTTPServer(("127.0.0.1", 0), MockUpstream)
        cls.upstream_port = upstream.server_address[1]
        threading.Thread(target=upstream.serve_forever, daemon=True).start()

        cls.data_dir = tempfile.TemporaryDirectory()
        cls.port = 18877
        env = dict(os.environ,
                   FDE_AI_API_KEY="test-key",
                   FDE_AI_BASE_URL=f"http://127.0.0.1:{cls.upstream_port}",
                   FDE_AI_MODEL="test-model")
        cls.server = subprocess.Popen(
            [sys.executable, str(APP / "server.py"), "--port", str(cls.port), "--data-dir", cls.data_dir.name],
            cwd=str(APP), env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(50):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{cls.port}/api/health", timeout=1)
                break
            except OSError:
                time.sleep(0.1)

    @classmethod
    def tearDownClass(cls):
        cls.server.terminate()
        cls.server.wait(timeout=5)
        cls.data_dir.cleanup()

    def test_term_flow_success_and_cache(self):
        MockUpstream.call_count = 0
        code, data = post(self.port, {"questionId": "FDE-M1-001", "term": "Embedding"})
        self.assertEqual(code, 200)
        self.assertFalse(data["cached"])
        self.assertEqual(data["kind"], "term")
        self.assertEqual(data["term"], "Embedding")
        self.assertEqual(data["explanation"]["one_liner"], "把文本转成向量，语义相近则向量相近。")
        self.assertEqual(MockUpstream.call_count, 1)
        # 第二次同题同术语命中缓存：上游不再被调用
        code, cached = post(self.port, {"questionId": "FDE-M1-001", "term": "Embedding"})
        self.assertEqual(code, 200)
        self.assertTrue(cached["cached"])
        self.assertEqual(MockUpstream.call_count, 1)

    def test_validation_and_not_found(self):
        self.assertEqual(post(self.port, {"questionId": "FDE-M1-001", "term": "   "})[0], 400)
        self.assertEqual(post(self.port, {"questionId": "FDE-M1-001", "term": "x" * 41})[0], 400)
        self.assertEqual(post(self.port, {"questionId": "FDE-X-999", "term": "RAG"})[0], 404)

    def test_cross_origin_rejected(self):
        code, data = post(self.port, {"questionId": "FDE-M1-001", "term": "RAG"}, origin="https://evil.example")
        self.assertEqual(code, 403)
        self.assertIn("跨站", data["error"])


if __name__ == "__main__":
    unittest.main()
