# 考点速览抽屉打不开：模块级函数引用渲染函数参数 + 短路求值掩盖 ReferenceError

- 日期：2026-11-04（修复 commit 83c37d7 防御 + 1103k 根因修复）
- 影响版本：1103c ~ 1103j（功能上线即坏，主路径从未工作）

## 问题现象

- 桌面/手机点击「考点速览」按钮无任何反应（无弹窗、无报错，1103c~1103h）。
- 1103i 加防御性 try/catch 后，错误终于显示在抽屉里：`考点速览打开异常：exam is not defined`。

## 排查过程

1. CSS z-index 审计：无遮挡问题（term-sheet z40 全场最高）。
2. server.log 误判：曾把无 PUT 伴随的 GET /api/ai/breakdown 认定为"点击触发了 fetch、代码已执行"——实际那些 GET 是 wireDiagnosis 在回看已提交题目时的自动加载，点击路径在 fetch 之前就抛异常了。
3. Chromium 多轮复现"正常"：headless 复现总是从**未作答的新题**进入，主路径从未覆盖。
4. 防御性 try/catch（把异常渲染进抽屉）上线后，用户一键复现出真实错误信息。

## 根因

`renderQuestion(q,position,total,exam)` 的第 4 个参数 `exam` 被模块级函数 `openBreakdownSheet` 直接引用：

```js
const unlocked=submitted&&!exam;  // exam 未定义
```

为什么测试长期测不出来——**短路求值**：复现流程里题目未提交，`submitted=false`，`&&` 右侧 `!exam` 从未求值，ReferenceError 不触发。而真实用户几乎总是在**已提交**的题上点开速览（`submitted=true`）→ 求值 → 抛错 →（旧版 `hidden=false` 在函数末尾）抽屉永不显示。

## 解决方案

1. 参数显式传递：`openBreakdownSheet(q,exam)`，调用点 `renderQuestion` 闭包内传参。
2. 防御性结构（保留）：`bdSheet.hidden=false` 放函数第一行；全函数 try/catch，异常文本直接显示在抽屉里并附构建号，引导用户反馈。

## 预防/注意事项

- **模块级函数不得引用渲染函数的参数**（同名惯性最容易犯）；ES module 严格模式下未声明标识符必抛 ReferenceError。
- **`&&`/`||` 短路会掩盖 ReferenceError**：错误分支挂在不常求值的一侧时，"复现不了"≠没问题。
- 前端交互测试必须覆盖**主路径状态**（本例=先提交再交互），只用初始态点一遍不算验证。
- 复现不了时，先给代码路径加"异常可见化"（try/catch + 界面显示 + console.error），让用户环境替你复现——本次 1103i 防御层正是靠它一击定位。
