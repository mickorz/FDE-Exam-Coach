"""FR-014 错题/收藏后台自动预热考点拆解缓存。

选择规则：题目末次作答错误，或已被收藏；且当前内容版本的拆解缓存未命中
（含题库改版后的失效缓存——需要重新生成）。按最近作答时间倒序、每轮限量，
逐题调用 service.breakdown（自动参与同题并发去重闸门），失败只记日志不影响其余。
"""

from . import service


def pending_questions(state, bank, config, store, limit=8):
    """返回需要预热的题目列表（question dict），最多 limit 道。"""
    candidates = []
    for qid, record in (state.get('records') or {}).items():
        attempts = record.get('attempts') or []
        favorite = bool(record.get('favorite'))
        wrong = bool(attempts) and attempts[-1].get('correct') is False
        if not (wrong or favorite):
            continue
        question = bank.get(qid)
        if question is None:
            continue
        if service.breakdown_cached(question, config, store) is not None:
            continue
        last_at = attempts[-1].get('at', 0) if attempts else 0
        candidates.append((last_at, qid, question))
    candidates.sort(key=lambda item: item[0], reverse=True)
    return [q for _, _, q in candidates[:limit]]


def _default_log(text):
    print(text, flush=True)  # 后台线程 + 文件重定向：必须显式 flush，否则日志憋在缓冲区


def run_cycle(state, bank, config, store, chat_fn=None, max_n=8, sleep_s=5.0, sleep_fn=None, log=_default_log):
    """生成一批拆解缓存：每题之间 sleep_s 秒错峰；返回逐题结果列表。"""
    if sleep_fn is None:
        import time
        sleep_fn = time.sleep
    if chat_fn is None:
        from .client import chat as chat_fn  # 默认真实上游；测试可注入 mock
    picked = pending_questions(state, bank, config, store, limit=max_n)
    results = []
    for question in picked:
        qid = question['id']
        try:
            record = service.breakdown(question, config, store, chat_fn=chat_fn)
            results.append({'id': qid, 'ok': True, 'cached': bool(record.get('cached'))})
            log(f'[auto-prewarm] {qid} 拆解完成（cached={record.get("cached")}）')
        except Exception as exc:  # 单题失败不中断本轮
            results.append({'id': qid, 'ok': False, 'error': str(exc)})
            log(f'[auto-prewarm] {qid} 拆解失败：{exc}')
        sleep_fn(sleep_s)
    return results
