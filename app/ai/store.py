"""AI 讲解缓存与每日限额存储（与学习记录 progress.json 分离）。"""

import datetime
import hashlib
import json
import os
import tempfile
import threading
from pathlib import Path

DAILY_LIMIT = 50


class AIStore:
    """ai-explanations.json：{"explanations": {key: record}, "usage": {"YYYY-MM-DD": n}}"""

    def __init__(self, data_dir: Path):
        self.path = Path(data_dir) / "ai-explanations.json"
        self.lock = threading.Lock()

    def cache_key(self, question_id: str, content_hash: str, answers: list, model: str) -> str:
        """同一题、同一内容版本、同一用户答案、同一模型才命中缓存。"""
        raw = "|".join([question_id, content_hash, ",".join(sorted(answers)), model])
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def _load(self) -> dict:
        if not self.path.exists():
            return {"explanations": {}, "usage": {}}
        return json.loads(self.path.read_text("utf-8"))

    def _save(self, data: dict) -> None:
        # 与 server.py 相同的原子写入策略
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, name = tempfile.mkstemp(prefix=".ai-", dir=self.path.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False)
                f.flush()
                os.fsync(f.fileno())
            os.replace(name, self.path)
        finally:
            if os.path.exists(name):
                os.unlink(name)

    def get(self, key: str):
        with self.lock:
            return self._load()["explanations"].get(key)

    def put(self, key: str, record: dict) -> None:
        with self.lock:
            data = self._load()
            data["explanations"][key] = record
            self._save(data)

    @staticmethod
    def _today(now=None) -> str:
        moment = now or datetime.datetime.now()
        return moment.strftime("%Y-%m-%d") if isinstance(moment, datetime.datetime) else str(now)[:10]

    def usage_today(self, now=None) -> int:
        with self.lock:
            return self._load()["usage"].get(self._today(now), 0)

    def bump_usage(self, now=None) -> None:
        with self.lock:
            data = self._load()
            today = self._today(now)
            data["usage"][today] = data["usage"].get(today, 0) + 1
            self._save(data)
