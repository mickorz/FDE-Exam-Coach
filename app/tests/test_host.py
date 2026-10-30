"""Host 白名单与同源校验测试（服务器部署支持）。"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class HostPolicyTests(unittest.TestCase):
    def test_default_loopback_only(self):
        server.configure_allowed_hosts('')
        self.assertTrue(server.origin_allowed(None, '127.0.0.1:8765'))
        self.assertTrue(server.origin_allowed('http://127.0.0.1:8765', '127.0.0.1:8765'))
        self.assertFalse(server.origin_allowed(None, 'evil.com'))
        self.assertFalse(server.origin_allowed('http://evil.com', '127.0.0.1:8765'))

    def test_domain_allowlist_with_tls_proxy(self):
        server.configure_allowed_hosts('fde.example.com')
        self.assertTrue(server.origin_allowed(None, 'fde.example.com'))
        self.assertTrue(server.origin_allowed('https://fde.example.com', 'fde.example.com'))
        # 本机回环始终保留
        self.assertTrue(server.origin_allowed(None, '127.0.0.1:8765'))
        # 白名单外 Host 拒绝；合法 Host 上的异源 Origin 拒绝
        self.assertFalse(server.origin_allowed(None, 'evil.com'))
        self.assertFalse(server.origin_allowed('https://evil.com', 'fde.example.com'))

    def test_allowlist_case_insensitive(self):
        server.configure_allowed_hosts('FDE.Example.COM')
        self.assertTrue(server.origin_allowed(None, 'fde.example.com'))

    def test_multiple_domains(self):
        server.configure_allowed_hosts('a.com, b.com')
        self.assertTrue(server.origin_allowed(None, 'a.com'))
        self.assertTrue(server.origin_allowed(None, 'b.com'))
        self.assertFalse(server.origin_allowed(None, 'c.com'))


if __name__ == '__main__':
    unittest.main()
