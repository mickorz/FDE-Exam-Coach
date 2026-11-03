"""AI 讲解业务编排（FR-005）：缓存 -> 限额 -> 调用 -> 校验 -> 落盘。"""

import datetime
import threading

from . import client, prompts
from .client import AIUpstreamError  # noqa: F401 重新导出，便于 server 统一捕获
from .store import DAILY_LIMIT, TERM_DAILY_LIMIT, BREAKDOWN_DAILY_LIMIT

# FR-013-CACHE-04 同题并发去重：同一缓存键生成中时，后来请求等待并复用结果（单进程内）
_BREAKDOWN_INFLIGHT: dict = {}
_INFLIGHT_LOCK = threading.Lock()


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
    key = store.cache_key(question["id"], content_hash, answers, model, prompts.PROMPT_VERSION)

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


def explain_term(question: dict, term: str, config: dict, store, chat_fn=client.chat, now=None):
    """生成或返回缓存的划词术语解释（关键词系统 P0）。

    与错题讲解共用存储与上游，但缓存键、每日限额均独立；返回记录含 cached 标记。
    """
    model = config.get("model") or client.DEFAULT_MODEL
    content_hash = question.get("review", {}).get("contentHash") or question.get("version") or "unknown"
    key = store.cache_key(question["id"], content_hash, ["term:" + term], model, prompts.TERM_PROMPT_VERSION)

    hit = store.get(key)
    if hit:
        return {**hit, "cached": True}

    if not config.get("api_key"):
        raise AIConfigError("尚未配置 AI 服务：请在 local-data/config.json 填入 api_key/base_url/model，或设置环境变量 FDE_AI_API_KEY")
    if store.usage_today(now, "term") >= TERM_DAILY_LIMIT:
        raise AIQuotaError(f"今日术语解释已达上限 {TERM_DAILY_LIMIT} 次，缓存命中的术语不受影响")

    prompt = prompts.build_term_prompt(question, term)
    raw = chat_fn(prompt, config)
    try:
        data = client.extract_json(raw)
    except ValueError as exc:
        raise AIParseError(f"AI 输出无法解析：{exc}") from exc

    missing = [field for field in prompts.TERM_REQUIRED_FIELDS if field not in data]
    if missing:
        raise AIParseError(f"AI 输出缺少字段：{'、'.join(missing)}")

    created_at = (now if isinstance(now, datetime.datetime) else datetime.datetime.now()).isoformat(timespec="seconds")
    record = {
        "kind": "term",
        "key": key,
        "question_id": question["id"],
        "content_hash": content_hash,
        "term": term,
        "model": model,
        "prompt_version": prompts.TERM_PROMPT_VERSION,
        "created_at": created_at,
        "explanation": data,
    }
    store.put(key, record)
    store.bump_usage(now, "term")
    return {**record, "cached": False}


def _validate_breakdown(data: dict, question: dict) -> None:
    """深度校验拆解输出（FR-013 §3.3）：why_others 必须覆盖全部错误选项，key_points 非空且结构合法。"""
    missing = [field for field in prompts.BREAKDOWN_REQUIRED_FIELDS if field not in data]
    if missing:
        raise ValueError(f"AI 输出缺少字段：{'、'.join(missing)}")
    points = data["key_points"]
    if not isinstance(points, list) or len(points) < 2 or not all(
        isinstance(p, dict) and isinstance(p.get("name"), str) and p["name"].strip()
        and isinstance(p.get("meaning"), str) and p["meaning"].strip() for p in points
    ):
        raise ValueError("key_points 至少 2 条，且每条需含非空的 name 与 meaning")
    for field in ("exam_focus", "solution_logic", "transfer"):
        if not isinstance(data[field], str) or not data[field].strip():
            raise ValueError(f"{field} 不能为空")
    expected = set(question["options"]) - set(question["answer"])
    others = data["why_others"]
    if not isinstance(others, list) or not all(
        isinstance(o, dict) and isinstance(o.get("option"), str) and isinstance(o.get("reason"), str) and o["reason"].strip()
        for o in others
    ):
        raise ValueError("why_others 每条需含选项字母 option 与非空 reason")
    got = {o["option"].strip().upper() for o in others}
    if got != {k.upper() for k in expected}:
        raise ValueError(f"why_others 必须逐一覆盖全部错误选项（应覆盖 {'、'.join(sorted(expected))}，实际 {('、'.join(sorted(got)) or '无')}）")


def _breakdown_key(question: dict, config: dict, store):
    model = config.get("model") or client.DEFAULT_MODEL
    content_hash = question.get("review", {}).get("contentHash") or question.get("version") or "unknown"
    return store.cache_key(question["id"], content_hash, ["breakdown"], model, prompts.BREAKDOWN_PROMPT_VERSION)


def breakdown_cached(question: dict, config: dict, store):
    """只读查询拆解缓存（FR-013-CACHE-02）：命中返回 {**record, cached:True}，未命中返回 None。绝不调 AI、不计额度。"""
    hit = store.get(_breakdown_key(question, config, store))
    return {**hit, "cached": True} if hit else None


def breakdown_stale(question: dict, config: dict, store) -> bool:
    """当前有效键未命中但存在同题旧版拆解 → True（提示“版本变化已失效”，不误用旧缓存）。"""
    model = config.get("model") or client.DEFAULT_MODEL
    content_hash = question.get("review", {}).get("contentHash") or question.get("version") or "unknown"
    fields = (content_hash, model, prompts.BREAKDOWN_PROMPT_VERSION)
    records = [r for r in store.find_by_question(question["id"]) if r.get("kind") == "breakdown"]
    if not records:
        return False
    return all((r.get("content_hash"), r.get("model"), r.get("prompt_version")) != fields for r in records)


def breakdown(question: dict, config: dict, store, chat_fn=client.chat, now=None):
    """生成或返回缓存的 AI 考点拆解（FR-013）。

    与作答无关（不携带用户答案）；服务端以自身题库为准；深度校验失败自动重试一次。
    """
    model = config.get("model") or client.DEFAULT_MODEL
    content_hash = question.get("review", {}).get("contentHash") or question.get("version") or "unknown"
    key = _breakdown_key(question, config, store)

    hit = store.get(key)
    if hit:
        return {**hit, "cached": True}

    if not config.get("api_key"):
        raise AIConfigError("尚未配置 AI 服务：请在 local-data/config.json 填入 api_key/base_url/model，或设置环境变量 FDE_AI_API_KEY")
    if store.usage_today(now, "breakdown") >= BREAKDOWN_DAILY_LIMIT:
        raise AIQuotaError(f"今日考点拆解已达上限 {BREAKDOWN_DAILY_LIMIT} 次，缓存命中的题目不受影响")

    # FR-013-CACHE-04 同键并发去重：首个请求生成，其余等待复用；不同题目互不阻塞
    with _INFLIGHT_LOCK:
        event = _BREAKDOWN_INFLIGHT.get(key)
        if event is None:
            event = threading.Event()
            _BREAKDOWN_INFLIGHT[key] = event
            owner = True
        else:
            owner = False
    if not owner:
        event.wait(timeout=180)
        hit = store.get(key)
        if hit:
            return {**hit, "cached": True}
        raise AIUpstreamError("同题拆解生成未成功，请稍后重试")

    try:
        prompt = prompts.build_breakdown_prompt(question)
        data = None
        last_error = ""
        for attempt in range(2):  # 深度校验失败重试一次（弱模型 why_others 漏项常见）
            raw = chat_fn(prompt, config)
            try:
                data = client.extract_json(raw)
                _validate_breakdown(data, question)
                break
            except ValueError as exc:
                last_error = str(exc)
                data = None
        if data is None:
            raise AIParseError(f"AI 拆解输出未通过校验（已重试）：{last_error}")

        created_at = (now if isinstance(now, datetime.datetime) else datetime.datetime.now()).isoformat(timespec="seconds")
        record = {
            "kind": "breakdown",
            "key": key,
            "question_id": question["id"],
            "content_hash": content_hash,
            "model": model,
            "prompt_version": prompts.BREAKDOWN_PROMPT_VERSION,
            "created_at": created_at,
            "explanation": data,
        }
        store.put(key, record)
        store.bump_usage(now, "breakdown")
        return {**record, "cached": False}
    finally:
        # 无论成败都释放同题去重闸门；失败不落缓存（CACHE-05），等待方读不到缓存即报错
        with _INFLIGHT_LOCK:
            _BREAKDOWN_INFLIGHT.pop(key, None)
        event.set()
