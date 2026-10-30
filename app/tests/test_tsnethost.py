"""FR-011-01 Tailscale Serve 转发兼容（*.ts.net Host）安全与可用性测试：

tailscale serve 反向代理可能保留原始 Host（机器名.tailnet.ts.net）。
验证：ts.net Host 下读/写均可用；非白名单域名仍被拒；跨站 Origin 写入仍被拒；
端口变体（:443）与 Origin 省略默认端口的组合可用。全部使用临时数据目录。
"""

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
TS_HOST = "mac-mini.tail1234.ts.net"


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class TsNetHostTests(unittest.TestCase):
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

    def request(self, path, method="GET", payload=None, host=None, origin=None):
        headers = {"Content-Type": "application/json", "X-FDE-Client": "offline-study"}
        if host:
            headers["Host"] = host
        if origin:
            headers["Origin"] = origin
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                body = r.read().decode("utf-8")
                return r.status, json.loads(body) if body else {}
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read().decode("utf-8"))

    def test_health_under_ts_net_host(self):
        status, body = self.request("/api/health", host=TS_HOST)
        self.assertEqual(status, 200)
        self.assertEqual(body["app"], "fde-study")

    def test_get_state_under_ts_net_host(self):
        status, _ = self.request("/api/state", host=TS_HOST)
        self.assertEqual(status, 200)

    def fresh_payload(self):
        """取当前服务端状态构造下一个合法保存载荷（revision 乐观锁）。"""
        _, state = self.request("/api/state")
        return {"schemaVersion": 1, "revision": state["revision"], "records": state["records"], "sessions": state["sessions"], "activeExam": state["activeExam"], "settings": state["settings"]}

    def test_put_state_same_origin_https_under_ts_net_host(self):
        payload = self.fresh_payload()
        status, body = self.request("/api/state", "PUT", payload, host=TS_HOST, origin=f"https://{TS_HOST}")
        self.assertEqual(status, 200, body)
        self.assertGreaterEqual(body["revision"], 1)

    def test_put_state_host_with_port_origin_without_port(self):
        """serve 转发 Host 可能带 :443，浏览器 Origin 省略默认端口。"""
        payload = self.fresh_payload()
        status, body = self.request("/api/state", "PUT", payload, host=f"{TS_HOST}:443", origin=f"https://{TS_HOST}")
        self.assertEqual(status, 200, body)

    def test_put_state_cross_origin_rejected_under_ts_net_host(self):
        payload = {"schemaVersion": 1, "revision": 0, "records": {}, "sessions": [], "activeExam": None, "settings": {}}
        status, body = self.request("/api/state", "PUT", payload, host=TS_HOST, origin="https://evil.example.com")
        self.assertEqual(status, 403)
        self.assertIn("跨站", body["error"])

    def test_evil_host_fully_blocked(self):
        for method, payload in (("GET", None), ("PUT", {"schemaVersion": 1, "revision": 0, "records": {}, "sessions": [], "activeExam": None, "settings": {}})):
            status, body = self.request("/api/state", method, payload, host="evil.example.com")
            self.assertEqual(status, 403)
            self.assertIn("只允许本机访问", body["error"])

    def test_suffix_lookalike_host_blocked(self):
        """fakets.net 不以 .ts.net 结尾的子域形式出现，不得放行。"""
        status, _ = self.request("/api/state", host="fakets.net")
        self.assertEqual(status, 403)
        status, _ = self.request("/api/state", host=".ts.net")
        self.assertEqual(status, 403)

    def test_localhost_regression(self):
        status, _ = self.request("/api/health")
        self.assertEqual(status, 200)
        status, _ = self.request("/api/state", host="localhost")
        self.assertEqual(status, 200)


if __name__ == "__main__":
    unittest.main()
