"""备考学习数据日报：从运行中的备考服务拉取学习记录并输出统计。

用法：
    python deploy/daily-stats.py [回看天数，默认 7]

可选环境变量：
    FDE_STATE_URL  学习记录 API 地址，默认为 Tailscale 服务地址
    （如部署在腾讯云，可设为 https://你的域名/api/state）

仅使用 Python 标准库；只读操作，不写任何数据。
"""
import collections
import datetime
import json
import os
import sys
import urllib.request

STATE_URL = os.environ.get(
    "FDE_STATE_URL",
    "https://fde-coach-mac.tail8c843b.ts.net/api/state",
)


def main():
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 7
    with urllib.request.urlopen(STATE_URL, timeout=30) as resp:
        state = json.load(resp)
    records = state.get("records", {})

    now = datetime.datetime.now().astimezone()
    today_start = datetime.datetime.combine(now.date(), datetime.time.min, tzinfo=now.tzinfo).timestamp() * 1000

    # 按日聚合近 N 天
    buckets = collections.OrderedDict()
    for i in range(days - 1, -1, -1):
        day = (now.date() - datetime.timedelta(days=i)).isoformat()
        start = today_start - i * 86400000
        buckets[day] = [start, start + 86400000, 0, 0, collections.Counter()]
    for r in records.values():
        for a in r["attempts"]:
            for day, (start, end, count, correct, modes) in buckets.items():
                if start <= a["at"] < end:
                    buckets[day][2] += 1
                    buckets[day][3] += a["correct"]
                    buckets[day][4][a.get("mode", "?")] += 1

    total_all = sum(len(r["attempts"]) for r in records.values())
    learned = sum(1 for r in records.values() if r["attempts"])

    daily_goal = state.get("settings", {}).get("dailyNew", 50)
    print(f"== 近 {days} 天（每日目标 {daily_goal} 道）==")
    for day, (start, end, count, correct, modes) in buckets.items():
        pct = f"{round(correct / count * 100)}%" if count else "-"
        bar = "#" * (count // 5)
        mark = " <- 昨日" if day == (now.date() - datetime.timedelta(days=1)).isoformat() else ""
        flag = " [达标]" if count >= daily_goal else ""
        print(f"{day}  {count:4d} 次 {bar} 正确率 {pct}{flag}{mark}")
        if modes and count:
            print(f"    模式: {dict(modes)}")

    wrong_pending = 0
    for r in records.values():
        if r["attempts"] and not r["attempts"][-1]["correct"]:
            wrong_pending += 1
    sessions = state.get("sessions", [])
    last_exam = sessions[-1] if sessions else None

    print()
    print("== 累计 ==")
    print(f"作答 {total_all} 次 | 已做题数 {learned} / 1000 | 考试 {len(sessions)} 场")
    if last_exam:
        print(f"最近考试：{last_exam['points']} 分（{last_exam['correct']}/{last_exam['total']}，{datetime.datetime.fromtimestamp(last_exam['finishedAt'] / 1000).isoformat(timespec='minutes')}）")
    else:
        print("还没有模拟考试记录")
    print(f"待复习错题（最近一次作答为错）：{wrong_pending} 道")
    exam_date = state.get("settings", {}).get("targetDate", "2026-11-23")
    exam = datetime.date.fromisoformat(exam_date)
    left = (exam - now.date()).days
    print(f"距考试（{exam_date}）还有 {left} 天")


if __name__ == "__main__":
    main()
