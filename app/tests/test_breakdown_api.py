"""AI 考点拆解接口测试（FR-013 Stage C）：/api/ai/breakdown 的路由、校验、缓存与守卫。"""

import json
import os
import re
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

# 从真实题库取目标题，Mock 上游按其选项动态生成覆盖全部错误选项的 why_others
with open(APP / "data" / "questions.json", encoding="utf-8") as f:
    BANK = {q["id"]: q for q in json.load(f)}
QUESTION_ID = "FDE-M1-001"


def completion_for(question_id: str) -> str:
    question = BANK[question_id]
    wrong = sorted(set(question["options"]) - set(question["answer"]))
    return json.dumps({
        "exam_focus": "考察能否按业务条件选择合适的知识接入方案。",
        "key_points": [
            {"name": "在线部署", "meaning": "让模型以服务形式可被调用"},
            {"name": "精调", "meaning": "在已有模型上针对任务继续训练"},
        ],
        "solution_logic": "先找业务约束，再区分两类动作的目的，最后逐项排除。",
        "why_others": [{"option": k, "reason": f"选项 {k} 不满足题干约束"} for k in wrong],
        "transfer": "如果企业要求模型稳定采用特定输出格式，应优先考虑什么？",
        "uncertain_points": [],
    }, ensure_ascii=False)


class MockUpstream(BaseHTTPRequestHandler):
    call_count = 0
    garbage = False

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length)
        MockUpstream.call_count += 1
        if MockUpstream.garbage:
            content = "模型今天不想输出 JSON"
        else:
            # 上游收到的是 chat 请求（prompt 文本），从 prompt 中反推题目 ID
            match = re.search(r"FDE-[A-Z0-9-]+", raw.decode("utf-8", "ignore"))
            content = completion_for(match.group(0)) if match else "prompt 中找不到题目 ID"
        body = json.dumps({"choices": [{"message": {"content": content}}]}, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def post(port, payload, origin=None, client=True):
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/api/ai/breakdown",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Origin": origin or f"http://127.0.0.1:{port}", **({"X-FDE-Client": "offline-study"} if client else {})},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


class BreakdownAPITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        upstream = HTTPServer(("127.0.0.1", 0), MockUpstream)
        cls.upstream_port = upstream.server_address[1]
        threading.Thread(target=upstream.serve_forever, daemon=True).start()

        cls.data_dir = tempfile.TemporaryDirectory()
        cls.port = 18879
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

    def test_breakdown_success_cache_and_coverage(self):
        MockUpstream.call_count = 0
        code, data = post(self.port, {"questionId": QUESTION_ID})
        self.assertEqual(code, 200)
        self.assertFalse(data["cached"])
        self.assertEqual(data["kind"], "breakdown")
        self.assertEqual(data["prompt_version"], "v1")
        wrong = sorted(set(BANK[QUESTION_ID]["options"]) - set(BANK[QUESTION_ID]["answer"]))
        self.assertEqual(sorted(o["option"] for o in data["explanation"]["why_others"]), wrong)
        self.assertEqual(MockUpstream.call_count, 1)
        # 第二次命中缓存：上游不再被调用
        code, cached = post(self.port, {"questionId": QUESTION_ID})
        self.assertEqual(code, 200)
        self.assertTrue(cached["cached"])
        self.assertEqual(MockUpstream.call_count, 1)

    def test_validation_not_found_and_guards(self):
        self.assertEqual(post(self.port, {"questionId": "不存在"})[0], 404)
        self.assertEqual(post(self.port, {"questionId": ""})[0], 400)
        code, data = post(self.port, {"questionId": QUESTION_ID}, origin="https://evil.example")
        self.assertEqual(code, 403)
        self.assertIn("跨站", data["error"])
        code, data = post(self.port, {"questionId": QUESTION_ID}, client=False)
        self.assertEqual(code, 403)
        self.assertEqual(data["error"], "请求标识无效")

    def test_upstream_garbage_maps_to_502(self):
        MockUpstream.garbage = True
        try:
            code, data = post(self.port, {"questionId": "FDE-M1-002"})
            self.assertEqual(code, 502)
            self.assertIn("校验", data["error"])
        finally:
            MockUpstream.garbage = False


if __name__ == "__main__":
    unittest.main()
