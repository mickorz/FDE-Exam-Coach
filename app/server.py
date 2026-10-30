#!/usr/bin/env python3
"""Offline-only study server. Standard library; binds loopback exclusively.

FDE Exam Coach 扩展（相对 FDE_Learning @abd6687）：
- POST /api/ai/explain：AI 错题讲解（FR-005），见 ai/ 模块；
- 题库内存缓存供 AI 组装提示词。
其余行为与上游一致。
"""
import argparse, json, os, sys, tempfile, threading, mimetypes, urllib.parse
from pathlib import Path
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

mimetypes.add_type('application/manifest+json', '.webmanifest')

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))  # 支持 ai/ 包导入
from ai import service as ai_service  # noqa: E402
from ai.store import AIStore  # noqa: E402

LOCK = threading.Lock()
STATE_PATH = ROOT / 'local-data' / 'progress.json'
BANK = None       # 题目 id -> question，懒加载
AI = None         # AIStore 单例，随 data-dir 初始化

# 允许的 Host 白名单：默认仅本机；部署到服务器经反向代理访问时用 --allowed-host 放行域名
ALLOWED_HOSTS = ['127.0.0.1', 'localhost']
TS_NET_SUFFIX = '.ts.net'  # Tailscale 为本 Tailnet 签发的域名后缀；无法被第三方 DNS 伪造，serve 转发保留原始 Host 时放行（FR-011-01）


def configure_allowed_hosts(spec=''):
    """设置 Host 白名单，spec 为逗号分隔域名；本机回环始终保留。"""
    global ALLOWED_HOSTS
    extra = [h.strip().lower() for h in (spec or '').split(',') if h.strip()]
    ALLOWED_HOSTS = list(dict.fromkeys(['127.0.0.1', 'localhost'] + extra))


def host_allowed(host_header):
    """Host 白名单：本机回环、--allowed-host 显式放行域名、以及 *.ts.net（Tailscale 签发，须为非空子域）。
    写操作另有 origin_allowed 同源校验，故放行 ts.net 不引入跨站写入风险。"""
    host = (host_header or '').split(':')[0].strip().lower()
    return host in ALLOWED_HOSTS or (host.endswith(TS_NET_SUFFIX) and len(host) > len(TS_NET_SUFFIX))


def origin_allowed(origin, host_header):
    """写操作同源校验：Host 必须在白名单内；Origin 若提供须与 Host 同源（http/https 均可，兼容反向代理 TLS；
    端口差异容忍——serve 转发可能带 :443 而浏览器 Origin 省略默认端口）。"""
    if not host_allowed(host_header):
        return False
    if not origin:
        return True
    o = origin.strip().rstrip('/').lower()
    host = host_header.strip().lower()
    host_no_port = host.split(':')[0]
    return o in ('http://' + host, 'https://' + host, 'http://' + host_no_port, 'https://' + host_no_port)


def bank():
    global BANK
    if BANK is None:
        BANK = {q['id']: q for q in json.loads((ROOT / 'data' / 'questions.json').read_text('utf-8'))}
    return BANK


def init_ai():
    global AI
    AI = AIStore(STATE_PATH.parent)
    return AI

def empty_state():
    return {'schemaVersion': 1, 'revision': 0, 'records': {}, 'sessions': [], 'activeExam': None, 'settings': {}}

def validate_state(value):
    if not isinstance(value, dict) or value.get('schemaVersion') != 1:
        raise ValueError('备份格式不受支持')
    if not isinstance(value.get('records'), dict) or not isinstance(value.get('sessions'), list):
        raise ValueError('学习记录结构无效')
    if len(value['records']) > 100000 or len(value['sessions']) > 10000:
        raise ValueError('记录超出安全上限')
    for key, record in value['records'].items():
        if not isinstance(key, str) or not isinstance(record, dict): raise ValueError('题目记录无效')
        if not isinstance(record.get('attempts', []), list): raise ValueError('答题记录无效')
    return value

def load_state():
    if not STATE_PATH.exists(): return empty_state()
    return validate_state(json.loads(STATE_PATH.read_text('utf-8')))

def save_state(state):
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='.progress-', dir=STATE_PATH.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(state, f, ensure_ascii=False); f.flush(); os.fsync(f.fileno())
        os.replace(name, STATE_PATH)
    finally:
        if os.path.exists(name): os.unlink(name)

class Handler(BaseHTTPRequestHandler):
    def valid_host(self):
        return host_allowed(self.headers.get('Host', ''))

    def reply(self, code, content, mime='application/json; charset=utf-8'):
        body = content if isinstance(content, bytes) else json.dumps(content, ensure_ascii=False).encode()
        self.send_response(code); self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers(); self.wfile.write(body)

    def do_GET(self):
        if not self.valid_host(): return self.reply(403, {'error':'只允许本机访问'})
        path = urllib.parse.urlparse(self.path).path
        if path == '/api/state':
            try:
                with LOCK: state = load_state()
                return self.reply(200, state)
            except Exception: return self.reply(500, {'error':'本地记录文件无法读取，请先备份 local-data 目录，不会自动覆盖。'})
        if path == '/api/health': return self.reply(200, {'app':'fde-study','version':'1.2.0','root':str(ROOT),'dataPath':str(STATE_PATH.resolve()),'pid':os.getpid()})
        allowed = {'/':'index.html', '/index.html':'index.html', '/data/questions.json':'data/questions.json', '/data/manifest.json':'data/manifest.json', '/data/quality.json':'data/quality.json', '/evidence.html':'evidence.html', '/data/rounds.json':'data/rounds.json', '/manifest.webmanifest':'manifest.webmanifest', '/icon-192.png':'icon-192.png', '/icon-512.png':'icon-512.png'}
        rel = allowed.get(path)
        if path.startswith('/src/'): rel = path.lstrip('/')
        if not rel: return self.reply(404, {'error':'未找到'})
        file = (ROOT / rel).resolve()
        if not file.is_relative_to(ROOT) or not file.is_file(): return self.reply(404, {'error':'未找到'})
        self.reply(200, file.read_bytes(), mimetypes.guess_type(file)[0] or 'application/octet-stream')

    def do_POST(self):
        if not self.valid_host(): return self.reply(403, {'error':'只允许本机访问'})
        path = urllib.parse.urlparse(self.path).path
        if path != '/api/ai/explain': return self.reply(404, {'error':'未找到'})
        origin = self.headers.get('Origin')
        if not origin_allowed(origin, self.headers.get('Host','')):
            return self.reply(403, {'error':'拒绝跨站写入'})
        try:
            length = int(self.headers.get('Content-Length','0'))
            if length <= 0 or length > 65536: raise ValueError('请求体过大或为空')
            payload = json.loads(self.rfile.read(length))
            question_id = payload.get('questionId'); answers = payload.get('answers')
            if not isinstance(question_id, str) or not isinstance(answers, list) or not answers or not all(isinstance(a, str) and len(a) == 1 and a.isalpha() and a.isupper() for a in answers):
                raise ValueError('请求参数无效')
            question = bank().get(question_id)
            if not question: return self.reply(404, {'error':'题库中不存在该题目'})
            from ai.client import load_config
            record = ai_service.explain(question, answers, load_config(STATE_PATH.parent), AI)
            return self.reply(200, record)
        except ai_service.AIError as exc:
            return self.reply(exc.code, {'error': str(exc)})
        except (ValueError, json.JSONDecodeError) as exc:
            return self.reply(400, {'error': str(exc)})
        except Exception:
            return self.reply(500, {'error':'AI 讲解服务异常，请稍后重试；不影响继续刷题'})

    def do_PUT(self):
        if not self.valid_host(): return self.reply(403, {'error':'只允许本机访问'})
        if self.path != '/api/state': return self.reply(404, {'error':'未找到'})
        origin = self.headers.get('Origin')
        if not origin_allowed(origin, self.headers.get('Host','')):
            return self.reply(403, {'error':'拒绝跨站写入'})
        if self.headers.get('X-FDE-Client') != 'offline-study': return self.reply(403, {'error':'请求标识无效'})
        try:
            length = int(self.headers.get('Content-Length','0'))
            if length <= 0 or length > 20_000_000: raise ValueError('备份文件过大或为空')
            incoming = validate_state(json.loads(self.rfile.read(length)))
            with LOCK:
                current = load_state()
                if incoming.get('revision',0) != current.get('revision',0):
                    return self.reply(409, {'error':'另一窗口已更新记录。请先导出当前记录，再刷新合并。'})
                incoming['revision'] = current.get('revision',0) + 1
                save_state(incoming)
            self.reply(200, {'revision':incoming['revision']})
        except (ValueError, json.JSONDecodeError) as exc: self.reply(400, {'error':str(exc)})
        except Exception: self.reply(500, {'error':'本地保存失败，请导出备份并检查磁盘权限。'})

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--data-dir', type=Path)
    parser.add_argument('--allowed-host', default='', help='反向代理部署时放行的域名，逗号分隔')
    args = parser.parse_args()
    if args.data_dir: STATE_PATH = args.data_dir / 'progress.json'
    configure_allowed_hosts(args.allowed_host)
    init_ai()
    try:
        httpd=ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
        print(f'FDE 备考已启动：http://127.0.0.1:{args.port} ；按 Ctrl+C 关闭。', flush=True)
        httpd.serve_forever()
    except KeyboardInterrupt: print('\n已关闭本地服务，学习记录已保留。')
    except OSError as exc:
        print(f'无法启动本地端口 {args.port}：{exc}。可用 --port 指定其它空闲端口。');raise SystemExit(1)
