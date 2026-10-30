"""AI 上游客户端：OpenAI 兼容 /chat/completions 接口，仅用标准库。"""

import json
import os
import urllib.error
import urllib.request
from pathlib import Path

DEFAULT_BASE_URL = "https://api.deepseek.com"
DEFAULT_MODEL = "deepseek-chat"
TIMEOUT_SECONDS = 60


class AIUpstreamError(Exception):
    """上游模型调用失败。"""


def load_config(data_dir: Path) -> dict:
    """读取 AI 配置：环境变量优先，其次 local-data/config.json。

    api_key 只存在于服务端内存，永不返回给浏览器。
    """
    cfg = {}
    config_path = data_dir / "config.json"
    if config_path.exists():
        try:
            cfg = json.loads(config_path.read_text("utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            raise AIUpstreamError(f"local-data/config.json 无法解析：{exc}") from exc
    return {
        "api_key": os.environ.get("FDE_AI_API_KEY") or cfg.get("api_key") or "",
        "base_url": (os.environ.get("FDE_AI_BASE_URL") or cfg.get("base_url") or DEFAULT_BASE_URL).rstrip("/"),
        "model": os.environ.get("FDE_AI_MODEL") or cfg.get("model") or DEFAULT_MODEL,
    }


def chat(prompt: str, config: dict) -> str:
    """调用 OpenAI 兼容接口，返回模型回复文本；失败抛 AIUpstreamError。"""
    if not config.get("api_key"):
        raise AIUpstreamError("未配置 API Key")
    payload = json.dumps({
        "model": config["model"],
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.3,
    }).encode("utf-8")
    request = urllib.request.Request(
        config["base_url"] + "/chat/completions",
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {config['api_key']}"},
        method="POST",
    )
    last_error = None
    for attempt in range(2):  # 网络类失败重试一次
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
                body = json.loads(response.read().decode("utf-8"))
            return body["choices"][0]["message"]["content"]
        except urllib.error.HTTPError as exc:
            detail = ""
            try:
                detail = exc.read().decode("utf-8")[:300]
            except OSError:
                pass
            # 4xx 是请求本身的问题（鉴权、参数），重试无意义
            raise AIUpstreamError(f"模型接口返回 {exc.code}：{detail}") from exc
        except (urllib.error.URLError, TimeoutError, OSError, KeyError, IndexError, json.JSONDecodeError) as exc:
            last_error = exc
    raise AIUpstreamError(f"模型接口调用失败：{last_error}")


def extract_json(text: str) -> dict:
    """从容错角度提取模型输出中的 JSON 对象（借鉴 wrong-notebook extractJsonObject）。"""
    if not isinstance(text, str):
        raise ValueError("模型输出不是文本")
    cleaned = text.strip()
    if "```" in cleaned:  # 剥掉 markdown 代码块围栏
        parts = cleaned.split("```")
        for part in parts:
            candidate = part.strip()
            if candidate.startswith("json"):
                cleaned = candidate[4:].strip()
                break
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("模型输出中未找到 JSON 对象")
    try:
        data = json.loads(cleaned[start:end + 1])
    except json.JSONDecodeError as exc:
        raise ValueError(f"JSON 解析失败：{exc}") from exc
    if not isinstance(data, dict):
        raise ValueError("JSON 顶层不是对象")
    return data
