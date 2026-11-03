# FR-013-CACHE 执行报告：AI 考点拆解持久缓存与零重复生成

- 日期：2026-11-04（凌晨收尾）
- 需求：`dev-docs/design/FR-013 补充需求：AI 考点拆解持久缓存与零重复生成.md`（CACHE-01 ~ CACHE-07）
- 结论：**七项功能需求与十条验收标准全部落地**，node 65/65 + python 54/54，真实链路（本机 + serve socks 路径）实测缓存命中、零重复生成。

## 交付内容

| 需求 | 实现 |
|---|---|
| CACHE-01 完整结果持久化 | 原有 ai-explanations.json 原子写（tmp+fsync+replace）；五段式全量落盘后才返回成功（未改动键算法，旧 10 条缓存继续命中） |
| CACHE-02 只读缓存 API + 自动展示 | 新增 `GET /api/ai/breakdown?questionId=`（只读、零 AI 调用、不计额度、不耗 Token）；前端已作答重进题自动拉取展示完整拆解；未命中显示生成按钮不自动生成；按钮"已缓存"文案改由服务端真相决定（不再只看 progress.json 摘要） |
| CACHE-03 缓存命中规则 | 键=questionId+contentHash+model+promptVersion+功能类型（Stage C 已含 prompt_version）；GET/POST 同键；命中不占 30 次/日额度（单测断言 usage 不变） |
| CACHE-04 并发去重 | service 层按缓存键 in-flight Event 闸门：首个请求生成、其余等待复用；不同题目互不阻塞；e2e 双线程并发断言上游仅 1 次调用 |
| CACHE-05 失败处理 | 校验失败重试一次后报 502 不落缓存（原有）；新增等待方拿到"同题拆解生成未成功"明确错误；无后台重试 |
| CACHE-06 缓存状态提示 | 已读取缓存（"0 次 AI 调用"标注）/尚未生成/正在生成（按钮禁用文案）/缓存失效（stale=true 提示版本变化）/生成失败（错误条 + 重试按钮） |
| CACHE-07 考试及数据兼容 | 模考隐藏入口不变；**交卷复盘页新增"AI 考点拆解（读取缓存）"**，只读不生成（未生成提示去练习页）；完整拆解不写 progress.json（仍只存 exam_focus 摘要）；/local-data 不在静态白名单 |

## 新增测试

- tests/test_breakdown_api.py：GET 只读流程（命中/未命中/404/400/usage 不变）、同题并发上游仅 1 次
- tests/test_ai.py：breakdown_cached/breakdown_stale（版本变化不误用旧缓存）、并发 owner 失败等待方报错且不落缓存

## 实测（2026-11-04，真实数据）

- 已有 10 条真实拆解缓存全部继续命中（键算法未变）
- 本机与 serve 远程链路 GET 同题：cached:true、五段完整、0 次 AI 调用
- UI_BUILD 1103f

## 验收对照（需求 §3 十条）

1✓ 上游一次+持久化；2✓ 二次查看零调用（GET 命中）；3✓ 刷新后自动展示零调用；4✓ 重启后缓存文件仍在（服务重启实测）；5✓ 并发只生成一次（e2e+单测）；6✓ 版本/模型/提示词变化不误命中（键组成+stale 单测）；7✓ 失败不显示已缓存、无无限重试；8✓ 读取不占额度（usage 断言）；9✓ 模考隔离（原有锁定 + 复盘只读）；10✓ 回归全绿 + 手机端待用户确认 1103f。
