"""端到端验收流程（PRD 7.3）：

导入题库 -> 作答记录（答错）-> AI 讲解 -> 缓存命中 -> 复习安排 -> 再次作答 -> 状态更新

真启动 server.py 子进程 + 本地模拟模型上游，全部使用临时数据目录，不触碰真实学习记录。
"""

import json
import socket
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

MOCK_COMPLETION = json.dumps({
    "agrees_with_official": True,
    "correct_explanation": "部署使模型可被调用，精调是针对任务的继续训练。",
    "why_user_wrong": "把在线部署误解为用样本更新权重。",
    "key_points": ["在线部署", "模型精调"],
    "confusable": ["部署与精调的职责边界"],
    "review_suggestions": ["产品文档：模型部署章节"],
    "uncertain_points": [],
}, ensure_ascii=False)


class MockUpstream(BaseHTTPRequestHandler):
    call_count = 0

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        self.rfile.read(length)
        MockUpstream.call_count += 1
        body = json.dumps({"choices": [{"message": {"content": MOCK_COMPLETION}}]}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class EndToEndTests(unittest.TestCase):
    process = None
    upstream = None

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.data_dir = Path(cls.tmp.name) / "local-data"
        cls.upstream = ThreadingHTTPServer(("127.0.0.1", free_port()), MockUpstream)
        threading.Thread(target=cls.upstream.serve_forever, daemon=True).start()
        cls.port = free_port()
        cls.process = subprocess.Popen(
            [sys.executable, str(ROOT / "server.py"), "--port", str(cls.port), "--data-dir", str(cls.data_dir)],
            cwd=str(ROOT),
            env={"SystemRoot": __import__("os").environ.get("SystemRoot", ""), "FDE_AI_API_KEY": "e2e-key", "FDE_AI_BASE_URL": f"http://127.0.0.1:{cls.upstream.server_address[1]}"},
        )
        cls.base = f"http://127.0.0.1:{cls.port}"
        cls.wait_ready()

    @classmethod
    def wait_ready(cls, timeout=15):
        import time
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(cls.base + "/api/health", timeout=2) as r:
                    if r.status == 200:
                        return
            except OSError:
                time.sleep(0.2)
        raise RuntimeError("server 未能在期限内启动")

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        cls.process.wait(timeout=10)
        cls.upstream.shutdown()
        cls.tmp.cleanup()

    def request(self, path, method="GET", payload=None, headers=None):
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = urllib.request.Request(
            self.base + path, data=data, method=method,
            headers={"Content-Type": "application/json", "X-FDE-Client": "offline-study", **(headers or {})},
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.status, json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read().decode("utf-8"))

    def test_full_study_flow(self):
        # 1. 题库已导入：从真实题库取一道题
        with urllib.request.urlopen(self.base + "/data/questions.json", timeout=30) as r:
            bank = json.loads(r.read().decode("utf-8"))
        self.assertEqual(len(bank), 1000)
        question = bank[0]
        wrong_answer = [k for k in question["options"] if k not in question["answer"]][0]

        # 1.5 PWA 资源可访问（FR-011-02 添加到主屏幕）
        with urllib.request.urlopen(self.base + "/manifest.webmanifest", timeout=10) as r:
            manifest = json.loads(r.read().decode("utf-8"))
            self.assertEqual(manifest["display"], "standalone")
        for icon in ("/icon-192.png", "/icon-512.png"):
            with urllib.request.urlopen(self.base + icon, timeout=10) as r:
                self.assertEqual(r.headers["Content-Type"], "image/png")
                self.assertEqual(r.read()[:8], b"\x89PNG\r\n\x1a\n")

        # 2. 作答记录：答错（模拟浏览器经 /api/state 提交的学习记录，含练习模式与题目版本）
        attempt = {"at": 1, "answers": [wrong_answer], "correct": False, "questionVersion": question["review"]["contentHash"], "mode": "chapter"}
        status, body = self.request("/api/state", "PUT", {"schemaVersion": 1, "revision": 0, "records": {question["id"]: {"attempts": [attempt], "favorite": False}}, "sessions": [], "activeExam": None, "settings": {"targetDate": "2026-11-23"}})
        self.assertEqual(status, 200)
        revision = body["revision"]

        # 3. AI 讲解：首次调用走模型
        status, record = self.request("/api/ai/explain", "POST", {"questionId": question["id"], "answers": [wrong_answer]})
        self.assertEqual(status, 200, record)
        self.assertFalse(record["cached"])
        for field in ("model", "prompt_version", "created_at", "explanation"):
            self.assertIn(field, record)
        self.assertEqual(MockUpstream.call_count, 1)

        # 4. 相同输入再次讲解：命中缓存，不再调模型（限制调用次数的手段之一）
        status, cached = self.request("/api/ai/explain", "POST", {"questionId": question["id"], "answers": [wrong_answer]})
        self.assertEqual(status, 200)
        self.assertTrue(cached["cached"])
        self.assertEqual(MockUpstream.call_count, 1)

        # 5. 学习记录更新：再次作答答对（间隔复习进入下一档），记录仍在
        correct_attempt = {"at": 2, "answers": question["answer"], "correct": True, "questionVersion": question["review"]["contentHash"], "mode": "wrong"}
        status, body = self.request("/api/state", "PUT", {"schemaVersion": 1, "revision": revision, "records": {question["id"]: {"attempts": [attempt, correct_attempt], "favorite": False}}, "sessions": [], "activeExam": None, "settings": {}})
        self.assertEqual(status, 200)
        status, state = self.request("/api/state")
        self.assertEqual(status, 200)
        self.assertEqual(len(state["records"][question["id"]]["attempts"]), 2, "历史作答必须完整保留")

        # 6. 请求参数非法时明确报错，不影响服务
        status, err = self.request("/api/ai/explain", "POST", {"questionId": "不存在", "answers": ["A"]})
        self.assertEqual(status, 404)
        status, err = self.request("/api/ai/explain", "POST", {"questionId": question["id"], "answers": "bad"})
        self.assertEqual(status, 400)

    def test_unconfigured_ai_reports_clear_error(self):
        """未配置 AI 时返回 400 与可操作的提示，且不影响 /api/state 可用。"""
        port = free_port()
        with tempfile.TemporaryDirectory() as d:
            process = subprocess.Popen(
                [sys.executable, str(ROOT / "server.py"), "--port", str(port), "--data-dir", d],
                cwd=str(ROOT),
                env={"SystemRoot": __import__("os").environ.get("SystemRoot", "")},
            )
            try:
                base = f"http://127.0.0.1:{port}"
                deadline = __import__("time").time() + 15
                while True:
                    try:
                        urllib.request.urlopen(base + "/api/health", timeout=2)
                        break
                    except OSError:
                        if __import__("time").time() > deadline:
                            raise
                        __import__("time").sleep(0.2)
                request = urllib.request.Request(base + "/api/ai/explain", data=json.dumps({"questionId": "FDE-M1-001", "answers": ["A"]}).encode(), method="POST", headers={"Content-Type": "application/json"})
                try:
                    urllib.request.urlopen(request, timeout=30)
                    self.fail("未配置时应报错")
                except urllib.error.HTTPError as exc:
                    self.assertEqual(exc.code, 400)
                    payload = json.loads(exc.read().decode("utf-8"))
                    self.assertIn("config.json", payload["error"])
            finally:
                process.terminate()
                process.wait(timeout=10)


if __name__ == "__main__":
    unittest.main()
