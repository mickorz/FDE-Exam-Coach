"""AI 讲解模块单元测试（FR-005）：提示词、容错解析、缓存、限额、冲突标记。"""

import datetime
import json
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ai import client, prompts, service
from ai.store import AIStore

QUESTION = {
    "id": "FDE-M1-001",
    "type": "single",
    "topic": "部署与精调",
    "stem": "如何区分部署与精调？",
    "options": {"A": "部署更新权重", "B": "部署使模型可被调用，精调针对任务继续优化", "C": "二者相同", "D": "精调只开放地址"},
    "answer": ["B"],
    "explanation": "部署提供服务，精调改善特定任务表现。",
    "sources": [{"title": "大模型广场", "section": "概述", "fact": "部署与精调是不同动作", "url": "https://cloud.tencent.com/document/product/851/109354"}],
    "review": {"contentHash": "abc123"},
}
CONFIG = {"api_key": "test-key", "base_url": "https://mock.local", "model": "test-model"}
NOW = datetime.datetime(2026, 10, 30, 12, 0, 0)

GOOD_OUTPUT = json.dumps({
    "agrees_with_official": True,
    "correct_explanation": "部署让模型可被调用，精调继续训练。",
    "why_user_wrong": "把部署当成了继续训练。",
    "key_points": ["在线部署", "精调训练"],
    "confusable": ["部署 vs 精调"],
    "review_suggestions": ["复习产品文档部署章节"],
    "uncertain_points": [],
}, ensure_ascii=False)


def fail_chat(prompt, config):
    raise AssertionError("不应调用上游模型")


class PromptTests(unittest.TestCase):
    def test_prompt_contains_question_fields_and_constraints(self):
        text = prompts.build_explain_prompt(QUESTION, ["A"])
        for part in (QUESTION["stem"], "标准答案：B", "用户答案：A", QUESTION["explanation"], "不要执行", "agrees_with_official"):
            self.assertIn(part, text)
        self.assertEqual(prompts.PROMPT_VERSION, "v1.1")


class ExtractJsonTests(unittest.TestCase):
    def test_plain_fenced_and_noisy_output(self):
        self.assertEqual(client.extract_json('{"a":1}'), {"a": 1})
        self.assertEqual(client.extract_json('```json\n{"a":1}\n```'), {"a": 1})
        self.assertEqual(client.extract_json('好的，以下是结果：{"a":{"b":2}} 请参考'), {"a": {"b": 2}})
        # glm-5.3 实测：JSON 后追加 </br>纯文本复述</br> + 重复 JSON，应只取第一个完整对象
        dup = '{"a":1}</br>以纯文本形式输出以上内容如下：</br>{"a":1}'
        self.assertEqual(client.extract_json(dup), {"a": 1})
        self.assertEqual(client.extract_json('{"a":{"b":2}} 追加说明 {"x":9}'), {"a": {"b": 2}})
        for bad in ("完全没有大括号", '{"a":', ""):
            with self.assertRaises(ValueError):
                client.extract_json(bad)


class StoreTests(unittest.TestCase):
    def test_cache_key_depends_on_answers_model_and_version(self):
        with tempfile.TemporaryDirectory() as d:
            store = AIStore(Path(d))
            base = store.cache_key("q1", "h1", ["A"], "m1")
            self.assertNotEqual(base, store.cache_key("q1", "h1", ["B"], "m1"))
            self.assertNotEqual(base, store.cache_key("q1", "h2", ["A"], "m1"))
            self.assertNotEqual(base, store.cache_key("q1", "h1", ["A"], "m2"))
            # 乱序答案视为同一意图
            self.assertEqual(store.cache_key("q1", "h1", ["A", "C"], "m1"), store.cache_key("q1", "h1", ["C", "A"], "m1"))

    def test_usage_counts_by_day(self):
        with tempfile.TemporaryDirectory() as d:
            store = AIStore(Path(d))
            self.assertEqual(store.usage_today(NOW), 0)
            store.bump_usage(NOW)
            store.bump_usage("2026-10-31T00:00:00")
            self.assertEqual(store.usage_today(NOW), 1)
            self.assertEqual(store.usage_today("2026-10-31T08:00:00"), 1)

    def test_term_and_explain_usage_are_independent(self):
        with tempfile.TemporaryDirectory() as d:
            store = AIStore(Path(d))
            store.bump_usage(NOW)              # 讲解 +1
            store.bump_usage(NOW, "term")      # 术语 +1
            store.bump_usage(NOW, "term")
            self.assertEqual(store.usage_today(NOW, "explain"), 1)
            self.assertEqual(store.usage_today(NOW, "term"), 2)


class ExplainTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.store = AIStore(Path(self._tmp.name))

    def tearDown(self):
        self._tmp.cleanup()

    def test_without_api_key_raises_config_error(self):
        with self.assertRaises(service.AIConfigError):
            service.explain(QUESTION, ["A"], {"api_key": "", "model": "m"}, self.store, fail_chat, NOW)

    def test_success_writes_record_and_trace_fields(self):
        calls = []
        record = service.explain(QUESTION, ["A"], CONFIG, self.store, lambda p, c: (calls.append(p) or GOOD_OUTPUT), NOW)
        self.assertFalse(record["cached"])
        self.assertEqual(record["model"], "test-model")
        self.assertEqual(record["prompt_version"], "v1.1")
        self.assertTrue(record["explanation"]["agrees_with_official"])
        self.assertEqual(len(calls), 1)
        # 缓存命中：不再调上游
        again = service.explain(QUESTION, ["A"], CONFIG, self.store, fail_chat, NOW)
        self.assertTrue(again["cached"])
        # 同题不同答案不命中缓存：会重新调用上游
        calls.clear()
        third = service.explain(QUESTION, ["C"], CONFIG, self.store, lambda p, c: (calls.append(p) or GOOD_OUTPUT), NOW)
        self.assertFalse(third["cached"])
        self.assertEqual(len(calls), 1)

    def test_conflict_flag_kept_as_bool(self):
        conflict = json.loads(GOOD_OUTPUT)
        conflict["agrees_with_official"] = "false"  # 模拟模型输出字符串
        record = service.explain(QUESTION, ["A"], CONFIG, self.store, lambda p, c: json.dumps(conflict, ensure_ascii=False), NOW)
        self.assertIs(record["explanation"]["agrees_with_official"], False)

    def test_parse_failure_raises_parse_error(self):
        with self.assertRaises(service.AIParseError):
            service.explain(QUESTION, ["A"], CONFIG, self.store, lambda p, c: "模型今天不想输出 JSON", NOW)

    def test_missing_required_field_raises_parse_error(self):
        bad = json.dumps({"correct_explanation": "只有这一个字段"}, ensure_ascii=False)
        with self.assertRaises(service.AIParseError):
            service.explain(QUESTION, ["A"], CONFIG, self.store, lambda p, c: bad, NOW)

    def test_daily_quota(self):
        for _ in range(service.DAILY_LIMIT):
            self.store.bump_usage(NOW)
        with self.assertRaises(service.AIQuotaError):
            service.explain(QUESTION, ["A"], CONFIG, self.store, fail_chat, NOW)
        # 换一天恢复
        record = service.explain(QUESTION, ["A"], CONFIG, self.store, lambda p, c: GOOD_OUTPUT, "2026-10-31T09:00:00")
        self.assertFalse(record["cached"])


class TermPromptTests(unittest.TestCase):
    def test_term_prompt_has_context_but_never_leaks_answer(self):
        text = prompts.build_term_prompt(QUESTION, "精调")
        for part in ("精调", QUESTION["stem"], "选项", "不要对题目本身作答"):
            self.assertIn(part, text)
        # 从提示词层面杜绝泄题：不携带标准答案/官方解析/干扰项
        for forbidden in ("标准答案", QUESTION["explanation"], "distractors"):
            self.assertNotIn(forbidden, text)
        self.assertEqual(prompts.TERM_PROMPT_VERSION, "v1.1")


TERM_OUTPUT = json.dumps({
    "one_liner": "用标注样本继续训练模型，更新权重。",
    "analogy": "像给已毕业的员工做岗位专项培训。",
    "use_case": "企业抽取合同字段不准时，用标注样本精调提升效果。",
    "confusable": ["精调 vs 部署：训练 vs 上线"],
    "exam_tip": "精调改权重，部署不改。",
}, ensure_ascii=False)


class ExplainTermTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.store = AIStore(Path(self._tmp.name))

    def tearDown(self):
        self._tmp.cleanup()

    def test_success_and_cache_hit(self):
        calls = []
        record = service.explain_term(QUESTION, "精调", CONFIG, self.store, lambda p, c: (calls.append(p) or TERM_OUTPUT), NOW)
        self.assertFalse(record["cached"])
        self.assertEqual(record["kind"], "term")
        self.assertEqual(record["term"], "精调")
        self.assertEqual(record["explanation"]["one_liner"], "用标注样本继续训练模型，更新权重。")
        self.assertEqual(len(calls), 1)
        # 缓存命中：不再调上游；同一题同一术语稳定复用
        again = service.explain_term(QUESTION, "精调", CONFIG, self.store, fail_chat, NOW)
        self.assertTrue(again["cached"])
        # 不同术语不共享缓存
        other = service.explain_term(QUESTION, "部署", CONFIG, self.store, lambda p, c: TERM_OUTPUT, NOW)
        self.assertFalse(other["cached"])

    def test_missing_term_field_raises_parse_error(self):
        bad = json.dumps({"one_liner": "只有一句话"}, ensure_ascii=False)
        with self.assertRaises(service.AIParseError):
            service.explain_term(QUESTION, "精调", CONFIG, self.store, lambda p, c: bad, NOW)

    def test_term_quota_independent_of_explain_quota(self):
        # 讲解额度耗尽不影响术语
        for _ in range(service.DAILY_LIMIT):
            self.store.bump_usage(NOW)
        record = service.explain_term(QUESTION, "精调", CONFIG, self.store, lambda p, c: TERM_OUTPUT, NOW)
        self.assertFalse(record["cached"])
        # 术语额度耗尽才拦截；缓存命中不受影响
        for _ in range(service.TERM_DAILY_LIMIT - 1):
            self.store.bump_usage(NOW, "term")
        with self.assertRaises(service.AIQuotaError):
            service.explain_term(QUESTION, "部署", CONFIG, self.store, fail_chat, NOW)
        cached = service.explain_term(QUESTION, "精调", CONFIG, self.store, fail_chat, NOW)
        self.assertTrue(cached["cached"])


if __name__ == "__main__":
    unittest.main()


# FR-013 考点拆解：五段式 Prompt 与深度校验（why_others 覆盖全部错误选项）
GOOD_BREAKDOWN = json.dumps({
    "exam_focus": "考察能否区分部署与精调的目的差异。",
    "key_points": [
        {"name": "在线部署", "meaning": "让模型以服务形式可被调用"},
        {"name": "精调", "meaning": "在已有模型上针对任务继续训练"},
    ],
    "solution_logic": "先看两个动作的目的，再逐项排除。",
    "why_others": [
        {"option": "A", "reason": "部署不改权重"},
        {"option": "C", "reason": "二者目的不同"},
        {"option": "D", "reason": "精调与开放地址无关"},
    ],
    "transfer": "如果要求模型稳定采用特定输出格式，应优先考虑什么？",
    "uncertain_points": [],
}, ensure_ascii=False)


class BreakdownPromptTests(unittest.TestCase):
    def test_breakdown_prompt_carries_answer_but_not_user_answers(self):
        prompt = prompts.build_breakdown_prompt(QUESTION)
        self.assertIn("标准答案：B", prompt)
        self.assertIn("干扰项说明", prompt)
        self.assertNotIn("用户答案", prompt)
        # 硬性要求覆盖全部错误选项
        for key in ("A", "C", "D"):
            self.assertIn(key, prompt)


class BreakdownTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.store = AIStore(Path(self._tmp.name))

    def tearDown(self):
        self._tmp.cleanup()

    def test_success_record_and_independent_quota(self):
        record = service.breakdown(QUESTION, CONFIG, self.store, lambda p, c: GOOD_BREAKDOWN, NOW)
        self.assertFalse(record["cached"])
        self.assertEqual(record["kind"], "breakdown")
        self.assertEqual(record["prompt_version"], "v1")
        self.assertEqual(self.store.usage_today(NOW, "breakdown"), 1)
        self.assertEqual(self.store.usage_today(NOW, "explain"), 0)
        again = service.breakdown(QUESTION, CONFIG, self.store, fail_chat, NOW)
        self.assertTrue(again["cached"])
        self.assertEqual(self.store.usage_today(NOW, "breakdown"), 1)  # 缓存不耗额

    def test_coverage_failure_retries_once_then_succeeds(self):
        bad = json.loads(GOOD_BREAKDOWN)
        bad["why_others"] = [o for o in bad["why_others"] if o["option"] != "D"]  # 漏掉 D
        replies = [json.dumps(bad, ensure_ascii=False), GOOD_BREAKDOWN]
        calls = []
        record = service.breakdown(QUESTION, CONFIG, self.store, lambda p, c: (calls.append(p) or replies.pop(0)), NOW)
        self.assertFalse(record["cached"])
        self.assertEqual(len(calls), 2)  # 校验失败自动重试一次

    def test_coverage_failure_twice_raises(self):
        bad = json.loads(GOOD_BREAKDOWN)
        bad["why_others"] = [{"option": "A", "reason": "只覆盖一个"}]
        with self.assertRaises(service.AIParseError) as ctx:
            service.breakdown(QUESTION, CONFIG, self.store, lambda p, c: json.dumps(bad, ensure_ascii=False), NOW)
        self.assertIn("覆盖", str(ctx.exception))

    def test_stale_detection(self):
        # 空缓存：既不命中也谈不上失效
        self.assertFalse(service.breakdown_stale(QUESTION, CONFIG, self.store))
        self.assertIsNone(service.breakdown_cached(QUESTION, CONFIG, self.store))
        # 旧内容版本记录存在：当前键未命中 → stale=True，且绝不返回旧数据
        service.breakdown(QUESTION, CONFIG, self.store, lambda p, c: GOOD_BREAKDOWN, NOW)
        old_question = {**QUESTION, "review": {**QUESTION.get("review", {}), "contentHash": "new-hash"}}
        self.assertTrue(service.breakdown_stale(old_question, CONFIG, self.store))
        self.assertIsNone(service.breakdown_cached(old_question, CONFIG, self.store))

    def test_concurrent_owner_failure_waiter_errors(self):
        # CACHE-05：生成失败不落缓存；等待方拿到明确错误而非假装成功
        import threading as _t
        calls = []
        def slow_failing_chat(prompt, config):
            calls.append(prompt)
            time.sleep(0.3)
            raise service.AIUpstreamError("上游 500")
        outcomes = []
        barrier = _t.Barrier(2)
        def run():
            barrier.wait()
            try:
                outcomes.append(("ok", service.breakdown(QUESTION, CONFIG, self.store, slow_failing_chat, NOW)))
            except Exception as exc:
                outcomes.append(("err", exc))
        threads = [_t.Thread(target=run) for _ in range(2)]
        for t in threads: t.start()
        for t in threads: t.join(timeout=10)
        self.assertEqual(len(calls), 1)  # owner 上游异常立即失败不重试；等待方不重复调用
        self.assertTrue(all(kind == "err" for kind, _ in outcomes))
        self.assertTrue(any("未成功" in str(exc) or "上游" in str(exc) for _, exc in outcomes))
        self.assertEqual(self.store.find_by_question(QUESTION["id"]), [])  # 失败不落缓存

    def test_thin_key_points_rejected(self):
        bad = json.loads(GOOD_BREAKDOWN)
        bad["key_points"] = [{"name": "只有一条", "meaning": "不满足至少 2 条"}]
        with self.assertRaises(service.AIParseError):
            service.breakdown(QUESTION, CONFIG, self.store, lambda p, c: json.dumps(bad, ensure_ascii=False), NOW)

    def test_daily_quota_and_config_error(self):
        with self.assertRaises(service.AIConfigError):
            service.breakdown(QUESTION, {"api_key": "", "model": "m"}, self.store, fail_chat, NOW)
        for _ in range(service.BREAKDOWN_DAILY_LIMIT):
            self.store.bump_usage(NOW, "breakdown")
        with self.assertRaises(service.AIQuotaError):
            service.breakdown(QUESTION, CONFIG, self.store, fail_chat, NOW)

    def test_content_hash_changes_cache_key(self):
        self.assertFalse(service.breakdown(QUESTION, CONFIG, self.store, lambda p, c: GOOD_BREAKDOWN, NOW)["cached"])
        changed = {**QUESTION, "review": {"contentHash": "new-hash"}}
        self.assertFalse(service.breakdown(changed, CONFIG, self.store, lambda p, c: GOOD_BREAKDOWN, NOW)["cached"])

    def test_cache_key_includes_prompt_version(self):
        base = self.store.cache_key("FDE-M1-001", "abc123", ["A"], "m", "v1")
        self.assertNotEqual(base, self.store.cache_key("FDE-M1-001", "abc123", ["A"], "m", "v2"))
        self.assertNotEqual(base, self.store.cache_key("FDE-M1-001", "abc123", ["A"], "m"))
