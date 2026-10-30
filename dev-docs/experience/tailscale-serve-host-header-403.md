# tailscale serve 转发保留 .ts.net Host 头：白名单应用整站 403

> 记录日期：2026-10-31 · 关联：FR-011（PRD V1.1）、`app/server.py`、`app/tests/test_tsnethost.py`

## 问题现象

备考服务（`server.py`）本机访问正常；模拟 `tailscale serve` 反向代理的转发形态（`Host: <机器名>.<tailnet>.ts.net`）访问时，**整站**返回 403 `{"error": "只允许本机访问"}`——页面、静态资源、API 全部不可用，不只是写操作。

## 排查过程

1. 读 `server.py` 发现 `valid_host()` 对**所有**请求（GET/PUT/POST）校验 `Host ∈ ['127.0.0.1', 'localhost']`（DNS rebinding 防护）。
2. `curl -H "Host: mac-mini.tail1234.ts.net" http://127.0.0.1:8765/api/health` → 403 实锤。
3. `tailscale serve` 反向代理的常见转发行为是**保留原始 Host 头**（.ts.net 域名），因此手机经 serve 访问必然命中该 403。

## 根因

Host 白名单防住了 DNS rebinding（任意攻击者域名 → 127.0.0.1），但没有区分"攻击者可伪造的域名"与"Tailscale 仅为本人 Tailnet 签发的 `*.ts.net` 域名"。后缀 `ts.net` 的子域由 Tailscale CA 按机器名签发，攻击者无法让自己的域名呈现为 `*.ts.net`。

## 解决方案

`server.py` 新增 `host_allowed()`：白名单（回环 + `--allowed-host` 显式放行）之外，自动放行 `*.ts.net` 非空子域；`origin_allowed()` 保持写操作 Origin 同源校验（防跨站写入），并做端口归一化（serve 可能转发 `Host: x.ts.net:443`，浏览器 Origin 省略默认端口）。新增 `tests/test_tsnethost.py` 8 项测试锁定行为（含 `fakets.net`/`.ts.net` 仿冒拒绝）。

注意：`--allowed-host` 参数仍然保留，用于非 Tailscale 反向代理（如腾讯云 Caddy 自有域名）。

## 预防/注意事项

- 任何"本机白名单 + 反向代理"组合的 Web 应用，接入 `tailscale serve` 前先确认代理是否保留原始 Host；保留则必须放行 `*.ts.net`（或显式 `--allowed-host <机器名>.ts.net`）。
- 放行 `*.ts.net` 的安全性前提：写路径有 Origin 同源校验（本应用 `origin_allowed` 满足）；若应用只靠 Host 防护，须另行评估。
- 别忘了 Origin/Host 端口形态差异（443 显式 vs 省略），否则读通了写仍 403。

## 实证补记（2026-10-31 凌晨，serve 真实链路）

授权登录后经 `tailscale serve`（https://fde-coach-mac.tail8c843b.ts.net/）用 socks5 代理走真实路径实测，确认上述推断成立：
- serve **确实保留 `.ts.net` Host 转发**：PUT + `Origin: https://<机器名>.ts.net` → 200（若 Host 被改写为回环，Origin 同源校验必拒）。
- 恶意 Origin（evil.com）PUT → 403，防护链在 serve 形态下正常。
- 另注意：写操作还需携带 `X-FDE-Client: offline-study` 头（应用第三道防护），测试脚本别漏。
