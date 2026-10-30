"""AI 讲解业务编排（FR-005）：缓存 -> 限额 -> 调用 -> 校验 -> 落盘。"""

import datetime

from . import client, prompts
from .client import AIUpstreamError  # noqa: F401 重新导出，便于 server 统一捕获
from .store import DAILY_LIMIT


class AIError(Exception):
    code = 500


class AIConfigError(AIError):
    code = 400


class AIQuotaError(AIError):
    code = 429


class AIParseError(AIError):
    code = 502


def explain(question: dict, answers: list, config: dict, store, chat_fn=client.chat, now=None):
    """生成或返回缓存的题目讲解。

    返回记录 dict（含 cached 标记）；所有失败以 AIError 子类抛出，由 server 映射 HTTP 状态码。
    """
    model = config.get("model") or client.DEFAULT_MODEL
    content_hash = question.get("review", {}).get("contentHash") or question.get("version") or "unknown"
    key = store.cache_key(question["id"], content_hash, answers, model)

    hit = store.get(key)
    if hit:
        return {**hit, "cached": True}

    if not config.get("api_key"):
        raise AIConfigError("尚未配置 AI 服务：请在 local-data/config.json 填入 api_key/base_url/model，或设置环境变量 FDE_AI_API_KEY")
    if store.usage_today(now) >= DAILY_LIMIT:
        raise AIQuotaError(f"今日 AI 讲解已达上限 {DAILY_LIMIT} 次，缓存命中的题目不受影响")

    prompt = prompts.build_explain_prompt(question, answers)
    raw = chat_fn(prompt, config)
    try:
        data = client.extract_json(raw)
    except ValueError as exc:
        raise AIParseError(f"AI 输出无法解析：{exc}") from exc

    missing = [field for field in prompts.REQUIRED_FIELDS if field not in data]
    if missing:
        raise AIParseError(f"AI 输出缺少字段：{'、'.join(missing)}")
    # 模型可能输出 "true"/"false" 字符串，需按语义转换而非真值判断（bool("false") 是 True）
    flag = data["agrees_with_official"]
    if isinstance(flag, str):
        data["agrees_with_official"] = flag.strip().lower() == "true"
    else:
        data["agrees_with_official"] = bool(flag)

    created_at = (now if isinstance(now, datetime.datetime) else datetime.datetime.now()).isoformat(timespec="seconds")
    record = {
        "key": key,
        "question_id": question["id"],
        "content_hash": content_hash,
        "model": model,
        "prompt_version": prompts.PROMPT_VERSION,
        "created_at": created_at,
        "explanation": data,
    }
    store.put(key, record)
    store.bump_usage(now)
    return {**record, "cached": False}
