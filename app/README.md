# FDE Exam Coach 备考应用（Phase 1 主工程）

本地离线备考系统：1000 道原创模拟题 + 章节刷题 + 模拟考试 + 错题本 + AI 错题讲解 + 今日学习任务。

## 来源与授权

本工程基于 [FDE_Learning](https://github.com/mickorz/FDE_Learning) 扩展，基线 commit `abd668708cf9c876069908b1d30b8fa3010cd6c5`（拷贝时逐字节一致，`tests/bank.test.mjs` 自动校验）。原项目题库与界面为同作者资产；上游许可状态见 `thirdparties/FDE_Learning/LICENSING.md`，公开发布（Phase 2）前需完成授权确认。

相对上游的扩展（详见 `dev-docs/research/2026-10-30-复用分析与技术选型报告.md`）：

| 模块 | 说明 |
|---|---|
| `ai/` | AI 错题讲解服务（Python 标准库，OpenAI 兼容接口）：提示词版本化、容错 JSON 解析、讲解缓存、每日限额（50 次/天）、答案冲突检测 |
| `src/today.js` | 今日任务首页（FR-006）：考试倒计时、新题目标、到期复习、薄弱模块、核心完成率 |
| `src/core.js` 增量 | 练习模式记录、错题四态推导、考试模块统计、今日推荐纯函数 |
| `src/app.js` 增量 | 未做题/随机练习入口、错因五分类标注、AI 讲解面板、错题状态筛选、模块正误统计 |

原始题库 `data/` 未做任何修改；AI 生成内容全部落盘 `local-data/ai-explanations.json`，与题库和学习记录分离。

## 本地运行

需要 Python 3.9+（仅标准库）。Windows 双击仓库根目录 `启动备考.bat`，或：

```sh
cd app
python server.py           # 默认 http://127.0.0.1:8765
python server.py --port 8766 --data-dir <目录>   # 指定端口与学习记录目录
```

## AI 配置（可选，不配置不影响刷题）

复制 `local-data/config.json.example` 为 `local-data/config.json` 并填入 API Key，或设置环境变量 `FDE_AI_API_KEY` / `FDE_AI_BASE_URL` / `FDE_AI_MODEL`。Key 只存在于服务端，不会下发浏览器。每日讲解上限 50 次；相同题目、相同答案、相同模型与提示词版本命中缓存，不重复计费。

## 测试

需要 Node.js 22+。全部测试使用临时数据目录，不会触碰真实学习记录。

```sh
npm test                                   # 前端逻辑与题库完整性（node --test）
python -m unittest discover -s tests -p "test_*.py"   # AI 单元测试 + 端到端 HTTP 流程
```

端到端流程（`tests/test_e2e.py`）：导入题库 -> 章节练习答错 -> 记录错题 -> AI 讲解（本地模拟模型上游）-> 缓存命中 -> 安排复习 -> 再次作答 -> 历史保留。
