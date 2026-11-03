"""AI 讲解模块单元测试（FR-005）：提示词、容错解析、缓存、限额、冲突标记。"""

import datetime
import json
import sys
import tempfile
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
