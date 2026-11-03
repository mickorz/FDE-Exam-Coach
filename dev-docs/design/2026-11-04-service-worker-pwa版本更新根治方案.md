# Service Worker 根治主屏 PWA 版本滞后方案（FR-013 附带基础设施）

- 日期：2026-11-04（方案定稿，待执行）
- 背景：`dev-docs/experience/ios-pwa-startup-snapshot-stale-ui-build.md`（iOS 主屏 WebApp 启动快照不拉新 HTML/JS，ETag/no-cache 无效，"进度新代码旧"）
- 优先级：P1（不阻塞考试复习，但每次发版都踩，建议 11-05 执行）
- 预估：~1 小时（含测试与真机验证）

## 目标

1. 主屏 PWA 打开即拿到最新前端版本（不再依赖用户手动 Safari ?v= 强刷）。
2. 顺带获得真离线能力：无网络（如关 VPN）时上次的页面骨架与静态资源仍可打开，联网后数据自动同步。

## 设计

### 新增 `app/sw.js`（服务端白名单需加此路径）

策略分三类：

| 资源 | 策略 | 说明 |
|---|---|---|
| `/`（index.html） | network-first，离线回退缓存 | 在线永远最新 HTML |
| `/src/*`、`/icon.svg`、`/manifest.webmanifest` | network-first，离线回退缓存 | JS 模块图跟随 HTML |
| `/data/*.json` | cache-first + 后台更新（stale-while-revalidate） | 4MB 题库不重复下载，次次开页面秒开 |
| `/api/*` | 永不缓存，直连网络 | 学习记录、AI 接口实时性优先 |

- 缓存名带版本：`fde-ui-<UI_BUILD>`。UI_BUILD 变化 ⇒ 新 cache 开张 ⇒ 旧 cache 整体删除（`activate` 里 `caches.keys()` 清理非当前版本）。
- SW 自更新：注册时 `updateViaCache:'none'`（绕过 HTTP 缓存检查 sw.js 本体）；`sw.js` 响应 `Cache-Control: no-cache`（由 server.py 静态分支自然提供，需确认不走 ETag 304 也行——直接给 no-store 或 no-cache 均可，保证拉新）。
- 新版就绪提示：页面监听 `registration.onupdatefound` / 每 30s `registration.update()`；检测到新 SW waiting 时顶部提示"新版本已就绪，点击刷新"→ `postMessage` 触发 `skipWaiting` + `clients.claim` + `location.reload()`。（P0 可简化为静默 skipWaiting+下次冷启动生效，提示条做成 P1 增强，先实现简单版）

### `app/server.py`

- 静态白名单 `allowed` map 增加 `'/sw.js': ROOT/'sw.js'`；其响应头确保 `Cache-Control: no-cache, must-revalidate`（现有静态分支已带 ETag+no-cache，天然满足，无需特殊处理；重点是不被 service worker 自己缓存）。
- `Service-Worker-Allowed: /` 头（scope=/ 需要，同路径部署其实不需要，但加上无害）。

### `app/index.html`

- 末尾注册：
  ```js
  if('serviceWorker' in navigator)
    navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'});
  ```
- 注意 iOS 旧系统（<11.3）不支持——注册包在 try/catch，不支持则一切照旧（渐进增强，零回归风险）。

### `app/src/app.js`

- 无需大改；UI_BUILD 已是版本源，sw.js 从构建时无法读取 JS 常量 ⇒ **sw.js 内自带 `const VERSION='1103g'` 需同步**（或 fetch 一个 `/src/version.json`；为免双源，推荐 server 端无新增文件，直接在 sw.js 顶部维护 VERSION 并在发版检查单里与 app.js UI_BUILD 同步递增）。
- 提示条（若做增强版）：app.js 加 `showUpdateToast()`，由 SW `postMessage` 触发。

## 兼容与风险

| 风险 | 对策 |
|---|---|
| SW 缓存了坏版本导致白屏 | network-first 下在线自动恢复；离线回退仅静态资源；`/api/*` 永不缓存 |
| 版本双源（UI_BUILD / sw VERSION）漂移 | 发版检查单加一行：两者必须同值；可用 node 测试断言读两文件正则比对 |
| iOS PWA 快照连 sw.js 都不拉？ | SW 规范保证 fetch 拦截优先于快照；真机验收覆盖此场景（见下） |
| 与现有 ETag/gzip 冲突 | 无：SW 之上仍走 HTTP 条件请求，304 依旧生效 |

## 测试计划

1. node 侧：新增 tests/version.test.mjs（或并入现有）断言 sw.js VERSION === app.js UI_BUILD。
2. 桌面 Safari/Chrome DevTools：Application→Service Workers 状态、offline 模式下页面骨架可开、数据请求失败提示正常。
3. 真机（关键验收）：
   - 手机主屏图标打开 → 右下角构建号 = 最新（发 1103h 后不再需要 Safari 强刷即见新号）；
   - 关 VPN（离线）打开主屏图标：页面能进入（数据可能提示离线），恢复 VPN 后刷新数据恢复；
   - 老进度无损：作答、自评、待巩固队列照常。
4. 回归：py + node 全量；模考流程不受影响。

## 发版检查单（新增两条）

- [ ] UI_BUILD 与 sw.js VERSION 同步递增
- [ ] 手机端用主屏图标（而非 Safari）验证构建号更新

## 关联

- 经验文档：`dev-docs/experience/ios-pwa-startup-snapshot-stale-ui-build.md`
- 指南排查表已有一行指向该经验文档；上线后更新两处文档结论（"已根治，SW 生效"）。
