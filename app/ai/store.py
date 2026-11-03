"""AI 讲解缓存与每日限额存储（与学习记录 progress.json 分离）。"""

import datetime
import hashlib
import json
import os
import tempfile
import threading
from pathlib import Path

DAILY_LIMIT = 50          # 错题讲解每日限额
TERM_DAILY_LIMIT = 50     # 划词术语解释每日限额（与讲解分开计数，互不占用）
BREAKDOWN_DAILY_LIMIT = 30  # AI 考点拆解每日限额（FR-013，缓存命中不耗额）


class AIStore:
    """ai-explanations.json：{"explanations": {key: record}, "usage": {"YYYY-MM-DD": n}}"""

    def __init__(self, data_dir: Path):
        self.path = Path(data_dir) / "ai-explanations.json"
        self.lock = threading.Lock()

    def cache_key(self, question_id: str, content_hash: str, answers: list, model: str, prompt_version: str = "") -> str:
        """同一题、同一内容版本、同一用户答案、同一模型、同一提示词版本才命中缓存。

        FR-013 评审 #8：prompt_version 缺列导致 v1.1 升级后旧缓存仍命中；现作为键一部分，
        提示词升级即自动失效旧缓存（不迁移旧数据）。
        """
        raw = "|".join([question_id, content_hash, ",".join(sorted(answers)), model, prompt_version])
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

    _USAGE_KEYS = {"explain": "usage", "term": "term_usage", "breakdown": "breakdown_usage"}

    def usage_today(self, now=None, kind: str = "explain") -> int:
        bucket = self._USAGE_KEYS.get(kind, "usage")
        with self.lock:
            return self._load().get(bucket, {}).get(self._today(now), 0)

    def bump_usage(self, now=None, kind: str = "explain") -> None:
        bucket = self._USAGE_KEYS.get(kind, "usage")
        with self.lock:
            data = self._load()
            today = self._today(now)
            counts = data.setdefault(bucket, {})
            counts[today] = counts.get(today, 0) + 1
            self._save(data)
