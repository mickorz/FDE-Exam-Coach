# glm-5.3 讲解输出尾部复述 JSON，导致解析失败

## 问题现象
2026-11-02 为备考服务接入智谱 glm-5.3（OpenAI 兼容接口）后，POST /api/ai/explain 稳定报错：
`AI 输出无法解析：JSON 解析失败：Extra data: line 1 column 607 (char 606)`。

## 排查过程
1. 怀疑提示词被忽略 → 抓取模型原始输出（直调 ai/client.chat）。
2. 原始输出为：`{完整 JSON 对象}` + `</br>以纯文本形式输出以上内容如下：</br>` + **重复一份同样的 JSON**（两次输出均如此）。
3. 定位 `app/ai/client.py extract_json()`：用 `find("{")` 到 `rfind("}")` 切片，两段 JSON 被连成一个字符串，`json.loads` 报 Extra data。

## 根因
glm-5.3 会无视"只输出 JSON"的指令，在 JSON 后追加纯文本复述；而提取函数假设"最后一个 } 即对象结尾"。

## 解决方案
`extract_json` 改用 `json.JSONDecoder().raw_decode(cleaned[start:])`：只解析第一个完整 JSON 对象，忽略其后一切内容。天然兼容：前后缀散文、`{...}{...}` 连体、markdown 围栏（保留原有剥围栏逻辑）。新增 2 个回归用例锁定（app/tests/test_ai.py）。

## 预防/注意事项
- 任何"从模型输出提取结构化数据"的代码，都不要用"首 { 到末 }"切片；用 raw_decode 取第一个完整值。
- 换模型供应商时，先直调 chat() 打印原始输出再接解析，第一时间暴露输出习惯差异。
- 本地配置在 app/local-data/config.json（已 gitignore，不入库）。
