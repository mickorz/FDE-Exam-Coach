# 手机远程访问卡在"正在载入本地题库"（gzip + ETag 缓存修复）

- 日期：2026-11-02
- 影响范围：FR-011 Tailscale 手机远程访问；本地电脑访问不受影响
- 状态：已修复并经真实 serve 链路实证

## 问题现象

手机经 Tailscale 远程打开应用，首屏长时间停留在"正在载入本地题库…"，弱网/流量环境下几乎不可用；电脑本机打开秒开。

## 排查过程

1. 查 `dev-docs/experience/` 无同类记录（仅 tailscale-serve-host-header-403.md，症状不同：那是整站 403，这是能连上但卡加载）。
2. 定位加载文案：`app/index.html:2` 静态占位 `<p class="loading">`，说明卡在 JS 应用挂载前。
3. 看 `app/src/app.js:196` 启动序列：首屏渲染前 `Promise.all` 须拉齐 `/data/questions.json`（1.9MB）+ `/data/quality.json`（2.1MB）+ `/data/rounds.json`（34K）+ manifest——**约 4MB**。
4. 看 `app/server.py` 的 `reply()`：所有响应一律 `Cache-Control: no-store` 且无任何压缩（Python 标准库默认行为）。
5. 网络 path：手机 → WireGuard（可能 DERP 中继）→ serve → 127.0.0.1。4MB 未压缩数据在流量/中继下传输极慢 → 卡死。

## 根因

服务端两个叠加问题：

1. **无 gzip**：Python stdlib http.server 不自动压缩，4MB JSON 原样传输；
2. **no-store**：连静态题库都不许缓存，每次冷启动/重开 PWA 全量重拉 4MB。

## 解决方案（app/server.py，2 处改动）

1. `reply()` 增加 gzip：客户端 `Accept-Encoding` 含 gzip 且 body ≥ 1KB → `gzip.compress(body, 6)` + `Content-Encoding: gzip` + `Vary: Accept-Encoding`（不声明 gzip 的老客户端自动回落原文）。
2. 静态资源（题库 JSON/前端/src/图标）改为 **ETag（`"size-mtime"`）+ `If-None-Match` → 304 空体 + `Cache-Control: no-cache, must-revalidate`**；题库升级后 mtime/size 变化 → ETag 变化 → 自动拉新，无缓存陈旧风险。`/api/state` 等动态接口保持 `no-store`（实时学习记录）。

实测（socks5 经 tailscaled → serve HTTPS 真实链路）：

| 资源 | 修复前 | 修复后 |
|---|---|---|
| questions.json | 2,017,021B | 404,292B（gzip） |
| quality.json | 2,240,084B | 267,335B（gzip） |
| 重访（If-None-Match） | 全量重拉 | **304，0 字节** |
| 冷启动总传输 | ≈4.2MB | ≈0.7MB（约 6 倍缩减） |

新增 `app/tests/test_http_cache.py` 5 项锁定（gzip 还原/无 gzip 回落/304/state 保持 no-store/大 JS 压缩），全量回归 npm 42/42 + python 30/30 绿。

## 预防 / 注意事项

- **标准库 http.server 上线远程访问，先补 gzip 和条件请求**——本地回环 4MB 无感，走真实网络就是灾难；这属于"本地测试通过掩盖远程问题"的典型。
- `launchctl kickstart` 的 label 以 plist 内 `<string>` 为准（本项目是 `com.fde.coach` 不是文件名 `com.fde-coach`），改完 server.py 必须 kickstart 重启才生效。
- 测远程链路不必等真机：`curl --proxy socks5h://127.0.0.1:1055 https://<machine>.<tailnet>.ts.net/...` 走的就是手机完全相同的 serve 路径（前提 tailscaled 带了 `--socks5-server` 参数）。
- 若未来题库改成超高频更新，no-cache 的"每次一个 RTT 重验证"仍是最优；不要退回 no-store。
