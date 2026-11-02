"""FR-011-01 远程加载性能修复（gzip + ETag/304）行为锁定测试：

手机经 Tailscale 冷启动曾卡在"正在载入本地题库"——首屏需拉约 4MB 题库 JSON，
而服务端一律 no-store 且无压缩。验证：
1. Accept-Encoding: gzip 时大文件/大响应压缩传输（Content-Encoding: gzip，可解压还原）；
2. 不带 gzip 的客户端仍拿到未压缩原文（兼容）；
3. 静态资源带 ETag，If-None-Match 命中返回 304 空体；
4. /api/state 仍为 no-store 且无 ETag（学习记录实时性不受缓存影响）。
全部使用临时数据目录。
"""

import gzip
import json
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class HttpCacheTests(unittest.TestCase):
    process = None

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.port = free_port()
        cls.process = subprocess.Popen(
            [sys.executable, str(ROOT / "server.py"), "--port", str(cls.port), "--data-dir", cls.tmp.name],
            cwd=str(ROOT),
        )
        cls.base = f"http://127.0.0.1:{cls.port}"
        deadline = time.time() + 15
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(cls.base + "/api/health", timeout=2):
                    break
            except OSError:
                time.sleep(0.2)
        else:
            raise RuntimeError("server 未能在期限内启动")

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        cls.process.wait(timeout=10)
        cls.tmp.cleanup()

    def fetch(self, path, headers=None):
        req = urllib.request.Request(self.base + path, headers=headers or {})
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                return resp, resp.read()
        except urllib.error.HTTPError as err:  # 304 等非 2xx：urllib 报错但响应可用
            return err, err.read()

    def test_big_json_gzipped_and_restorable(self):
        """手机路径：gzip 传输大题库且解压后与原文一致。"""
        raw = (ROOT / "data" / "questions.json").read_bytes()
        resp, body = self.fetch("/data/questions.json", {"Accept-Encoding": "gzip"})
        self.assertEqual(resp.headers.get("Content-Encoding"), "gzip")
        self.assertLess(len(body), len(raw) / 2, "压缩后应显著小于原文")
        self.assertEqual(gzip.decompress(body), raw)
        self.assertEqual(resp.headers.get("Cache-Control"), "no-cache, must-revalidate")

    def test_no_gzip_client_gets_plain_body(self):
        """不声明 gzip 的客户端拿到未压缩原文。"""
        resp, body = self.fetch("/data/manifest.json")
        self.assertIsNone(resp.headers.get("Content-Encoding"))
        self.assertEqual(body, (ROOT / "data" / "manifest.json").read_bytes())

    def test_etag_304_on_revisit(self):
        """重访带 If-None-Match 命中 ETag → 304 空体（零字节传输）。"""
        resp, _ = self.fetch("/data/questions.json")
        etag = resp.headers.get("ETag")
        self.assertTrue(etag)
        resp2, body2 = self.fetch("/data/questions.json", {"If-None-Match": etag, "Accept-Encoding": "gzip"})
        self.assertEqual(resp2.status, 304)
        self.assertEqual(body2, b"")

    def test_api_state_still_no_store(self):
        """/api/state 保持 no-store 且无 ETag（实时学习记录）。"""
        resp, body = self.fetch("/api/state", {"Accept-Encoding": "gzip"})
        self.assertEqual(resp.headers.get("Cache-Control"), "no-store")
        self.assertIsNone(resp.headers.get("ETag"))
        state = json.loads(gzip.decompress(body) if resp.headers.get("Content-Encoding") == "gzip" else body)
        self.assertIn("revision", state)

    def test_src_js_gzipped_for_phone(self):
        """大体积前端模块（/src/app.js）也走压缩（手机弱网传输量）。"""
        resp, body = self.fetch("/src/app.js", {"Accept-Encoding": "gzip"})
        self.assertEqual(resp.headers.get("Content-Encoding"), "gzip")
        self.assertEqual(gzip.decompress(body), (ROOT / "src" / "app.js").read_bytes())


if __name__ == "__main__":
    unittest.main()
