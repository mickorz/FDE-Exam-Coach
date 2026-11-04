import json, sys, tempfile, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ai import auto, service  # noqa: E402
from ai.store import AIStore   # noqa: E402


QUESTION = {
    'id': 'FDE-T-001', 'module': 'M1', 'topic': '测试主题一', 'type': 'single',
    'stem': '测试题干？', 'options': {'A': '甲', 'B': '乙', 'C': '丙', 'D': '丁'}, 'answer': ['B'],
    'explanation': '官方解析', 'distractors': {'A': '甲不对', 'C': '丙不对', 'D': '丁不对'},
    'difficulty': 'medium', 'sources': [], 'review': {'contentHash': 'hash-1'},
}
QUESTION2 = {**QUESTION, 'id': 'FDE-T-002', 'topic': '测试主题二', 'review': {'contentHash': 'hash-2'}}
CONFIG = {'api_key': 'k', 'base_url': 'http://upstream', 'model': 'm'}


def good_payload(q):
    wrong = [k for k in q['options'] if k not in q['answer']]
    return {
        'exam_focus': '考察根据约束选方案的判断能力。',
        'key_points': [{'name': '甲', 'meaning': '含义一'}, {'name': '乙', 'meaning': '含义二'}],
        'solution_logic': '先找约束，再逐一排除。',
        'why_others': [{'option': k, 'reason': f'{k} 不满足题意'} for k in wrong],
        'transfer': '换成另一个场景再判断一次。',
    }


class PendingQuestionsTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.store = AIStore(Path(self._tmp.name))
        self.bank = {q['id']: q for q in (QUESTION, QUESTION2)}

    def tearDown(self):
        self._tmp.cleanup()

    def test_wrong_favorite_and_recovered_selection(self):
        state = {'records': {
            'FDE-T-001': {'attempts': [{'at': 100, 'answers': ['A'], 'correct': False, 'questionVersion': 'v1'}]},
            'FDE-T-002': {'favorite': True},  # 仅收藏、从未作答
        }}
        picked = auto.pending_questions(state, self.bank, CONFIG, self.store)
        self.assertEqual([q['id'] for q in picked], ['FDE-T-001', 'FDE-T-002'])

    def test_correct_last_and_unrelated_skipped(self):
        state = {'records': {
            'FDE-T-001': {'attempts': [
                {'at': 100, 'answers': ['A'], 'correct': False, 'questionVersion': 'v1'},
                {'at': 200, 'answers': ['B'], 'correct': True, 'questionVersion': 'v1'},  # 挽回：末次答对
            ]},
        }}
        self.assertEqual(auto.pending_questions(state, self.bank, CONFIG, self.store), [])
        state['records']['FDE-T-999'] = {'attempts': [{'at': 1, 'answers': ['A'], 'correct': False, 'questionVersion': 'v1'}]}
        self.assertEqual(auto.pending_questions(state, self.bank, CONFIG, self.store), [])  # 题库外的 id 忽略

    def test_cached_skipped_and_stale_regenerated(self):
        state = {'records': {'FDE-T-001': {'attempts': [{'at': 100, 'answers': ['A'], 'correct': False, 'questionVersion': 'v1'}]}}}
        service.breakdown(QUESTION, CONFIG, self.store, lambda p, c: json.dumps(good_payload(QUESTION), ensure_ascii=False))
        self.assertEqual(auto.pending_questions(state, self.bank, CONFIG, self.store), [])  # 已缓存，跳过
        revised = {**QUESTION, 'review': {'contentHash': 'hash-1-new'}}
        bank = {**self.bank, 'FDE-T-001': revised}
        picked = auto.pending_questions(state, bank, CONFIG, self.store)
        self.assertEqual([q['id'] for q in picked], ['FDE-T-001'])  # 题库改版→失效→重新预热

    def test_order_recent_first_and_limit(self):
        state = {'records': {
            'FDE-T-001': {'attempts': [{'at': 100, 'answers': ['A'], 'correct': False, 'questionVersion': 'v1'}]},
            'FDE-T-002': {'attempts': [{'at': 900, 'answers': ['A'], 'correct': False, 'questionVersion': 'v1'}]},
        }}
        picked = auto.pending_questions(state, self.bank, CONFIG, self.store, limit=1)
        self.assertEqual([q['id'] for q in picked], ['FDE-T-002'])  # 最近作答的先预热；limit 生效


class RunCycleTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.store = AIStore(Path(self._tmp.name))
        self.bank = {q['id']: q for q in (QUESTION, QUESTION2)}

    def tearDown(self):
        self._tmp.cleanup()

    def test_generates_in_picked_order_with_pacing(self):
        state = {'records': {
            'FDE-T-001': {'attempts': [{'at': 100, 'answers': ['A'], 'correct': False, 'questionVersion': 'v1'}]},
            'FDE-T-002': {'attempts': [{'at': 900, 'answers': ['A'], 'correct': False, 'questionVersion': 'v1'}]},
        }}
        queue = [good_payload(QUESTION2), good_payload(QUESTION)]  # picked 顺序：002 → 001
        sleeps, logs = [], []
        results = auto.run_cycle(state, self.bank, CONFIG, self.store,
                                 chat_fn=lambda p, c: json.dumps(queue.pop(0), ensure_ascii=False),
                                 sleep_s=0.5, sleep_fn=sleeps.append, log=logs.append)
        self.assertEqual([r['id'] for r in results], ['FDE-T-002', 'FDE-T-001'])
        self.assertTrue(all(r['ok'] and not r['cached'] for r in results))
        self.assertEqual(sorted(r['question_id'] for r in self.store.find_by_question('FDE-T-001') + self.store.find_by_question('FDE-T-002')),
                         ['FDE-T-001', 'FDE-T-002'])  # 各落一条拆解缓存
        self.assertEqual(sleeps, [0.5, 0.5])
        self.assertTrue(any('拆解完成' in line for line in logs))

    def test_single_failure_does_not_break_cycle(self):
        state = {'records': {
            'FDE-T-002': {'attempts': [{'at': 900, 'answers': ['A'], 'correct': False, 'questionVersion': 'v1'}]},
            'FDE-T-001': {'attempts': [{'at': 100, 'answers': ['A'], 'correct': False, 'questionVersion': 'v1'}]},
        }}
        calls = []

        def flaky_chat(prompt, config):
            calls.append(prompt)
            if len(calls) == 1:
                raise service.client.AIUpstreamError('上游超时')  # 第一题（002）失败
            return json.dumps(good_payload(QUESTION), ensure_ascii=False)

        sleeps, logs = [], []
        results = auto.run_cycle(state, self.bank, CONFIG, self.store,
                                 chat_fn=flaky_chat, sleep_s=0, sleep_fn=sleeps.append, log=logs.append)
        self.assertEqual([(r['id'], r['ok']) for r in results], [('FDE-T-002', False), ('FDE-T-001', True)])
        self.assertIn('上游超时', results[0]['error'])
        self.assertEqual(self.store.find_by_question('FDE-T-002'), [])  # 失败不落缓存


if __name__ == '__main__':
    unittest.main()
