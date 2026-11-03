# iOS 主屏 PWA 启动快照导致前端版本不更新（UI_BUILD 停留旧值）

- 日期：2026-11-04
- 关联：`dev-docs/experience/mobile-remote-loading-stuck-gzip-cache.md`（同为手机远程访问体验问题，但根因不同：那篇是传输层，本篇是客户端缓存层）
- 影响：每次发新版（UI_BUILD 1103a→…→1103f），手机主屏图标打开的 PWA 可能长时间停留在旧版本，且**杀后台重开也未必恢复**；而数据（题库/学习记录）又是新的——造成"功能上了但手机看不到"的错觉，极易误判为部署失败。

## 问题现象

服务端已部署 1103f（`curl http://127.0.0.1:8765/src/app.js` 返回 `UI_BUILD='1103f'`），用户手机主屏 PWA 右下角仍显示 1103d。此前 1102→1103a→1103d 多次出现过同类滞后，一般"杀后台重开"能解决，本次无效。

## 排查过程（2026-11-04 00:03–00:05 server.log 实证）

1. 服务端核实：`GET /src/app.js` 返回 200，内容含 1103f；响应头正确——`ETag: "d191-6aea04ec"`、`Cache-Control: no-cache, must-revalidate`。**排除服务端缓存策略问题**（条件请求机制本身是好的）。
2. log 关键对比：
   - `00:03:14` 主屏 PWA 冷启动：只出现 `GET /data/questions.json 304`、`GET /api/state 200`——**完全没有 `GET /`、`GET /src/app.js`**。即：iOS 用本地快照渲染了 HTML 和全部 JS 模块，只有应用内 fetch 的数据走网络。
   - `00:04:36` 用 Safari 打开 `/?v=1102c`：`GET /?v=1102c 200`、`GET /src/app.js 200`、`GET /src/styles.css 200`，其余模块 304——Safari 路径正常重新拉取了新版 JS。
3. 结论：不是没部署、不是 serve 缓存、不是 ETag 失效——是**主屏 WebApp 的启动快照根本不发请求**，任何 HTTP 层缓存头（ETag/no-cache）对它无效。

## 根因

iOS 把添加到主屏的 WebApp（standalone PWA）的启动资源（index.html + ES module 依赖图）存为本地快照，冷启动直接用快照渲染以加快打开速度；快照刷新时机由系统决定（通常数天、受存储压力影响，且不可控）。应用运行期的 `fetch()`（数据 JSON、/api/state）不受快照影响，所以学习进度永远是新的——版本滞后只发生在代码层。杀后台重开只是结束进程，不必然丢弃快照。

## 解决方案

### 用户侧（立即恢复，按顺序试）

1. **Safari 强刷感染法**（首选，最常用）：Safari 打开 `https://<地址>/?v=任意字符`（查询串绕过快照）→ 等页面完全加载 → 回主屏图标重开。快照常被此次加载替换。
2. 清除 Safari 网站数据：设置 → Safari → 高级 → 网站数据 → 删除该站点（会连 PWA 图标一起失效，需重新添加主屏）。
3. 重启手机（最后手段）。

### 工程侧（根治，登记待做）

上 **Service Worker**：

- `/sw.js` 策略：`/`、`/src/*` network-first（在线永远拿最新，离线回退缓存——顺带获得真离线能力）；`/data/*` cache-first+后台更新。
- 缓存名带版本（如 `fde-1103f`），`UI_BUILD` 变化即旧缓存整体失效。
- SW 自身用 `updateViaCache: 'none'` 注册 + `registration.update()` + 检测到新版时提示"新版本已就绪，点击刷新"。
- 注意：SW 的 fetch 拦截对主屏 PWA 的模块加载同样生效，可穿透启动快照问题；这是各 PWA 产品通行的解法。
- 登记位置：FR-013 P1 池相邻的待办（UI_BUILD 更新机制改造），实现时须同步更新本文档结论。

## 预防

1. 每次发版后核对构建号，**一律用 Safari `?v=` 法验证**，不要以主屏 PWA 的显示为准下"没部署成功"的结论。
2. 回归测试不覆盖此场景（需要真机 iOS），发版检查单人工过一遍。
3. 上线 SW 前，可在发版说明里附"手机看旧版时用 Safari 打开一次"的固定话术。

## 附注

- 服务端静态资源缓存头实测正确（ETag=size-mtime、no-cache,must-revalidate、gzip、304），与本问题无关，无需改动。
- 桌面 Safari/Chrome 桌面版未复现此问题（正常条件请求）。
