# Tailscale 手机访问指南（FR-011）

**需求来源：** PRD V1.1 补充需求（dev-docs/design/FDE Exam Coach — PRD V1.1 补充需求.md）
**目标：** 手机在外网（移动数据）通过 Tailscale 私有网络访问备考系统；PC 与手机共用同一服务端数据，无需手动同步。

## 架构

```text
手机浏览器 --Tailscale 私有网络(加密)-- Mac mini
                                       ├─ tailscale serve --bg 8765  (HTTPS 证书自动管理)
                                       └─ server.py 127.0.0.1:8765   (仅本机监听)
数据：app/local-data/progress.json（PC 与手机访问的是同一份）
```

不开放公网端口、不使用 Funnel、不暴露数据库；仅同一 Tailnet 内授权设备可达。

## 一次性准备

1. **电脑与手机安装 Tailscale** 并登录同一账号（Tailnet）。
   - Mac mini：App Store 或 `brew install tailscale`，菜单栏登录。
   - iPhone/Android：应用商店安装 Tailscale，登录后开启 VPN 开关。
2. **开启 Tailnet 的 HTTPS**：Tailscale 管理后台（login.tailscale.com）-> DNS -> 开启 MagicDNS 与 HTTPS 证书（一次性）。
3. **手机添加到主屏幕（PWA）**：手机浏览器打开访问地址 -> 分享菜单 -> "添加到主屏幕"。之后点击桌面图标即全屏进入，体验接近小程序。

## 日常使用

| 平台 | 启动方式 |
|---|---|
| Mac mini（推荐常驻） | 双击 `deploy/启动备考-mac.command`；或安装 `deploy/com.fde-coach.plist` 开机自启 + 崩溃自动重启 |
| Windows（开发机临时用） | 双击 `启动备考.bat`（已自动执行 `tailscale serve --bg 8765`） |
| 手机 | 打开主屏幕图标即可（电脑在线时） |

关键命令：

```bash
tailscale serve --bg 8765    # 配置私有 HTTPS 代理（后台持续生效）
tailscale serve status       # 查看访问地址（https://机器名.tailnet名.ts.net）
tailscale serve --https=443 off   # 撤销代理（如需）
```

### Mac mini 开机自启（launchd）

```bash
# 替换为仓库绝对路径后执行
sed "s|__APP_DIR__|/Users/你的用户名/fde-exam-coach|g" deploy/com.fde-coach.plist > ~/Library/LaunchAgents/com.fde-coach.plist
launchctl load ~/Library/LaunchAgents/com.fde-coach.plist
# 查看状态：launchctl list | grep fde ；日志：app/local-data/server.log
```

## 多端数据一致性规则（FR-011-03）

- PC 与手机读写的是**同一个服务端文件**（`local-data/progress.json`），作答即保存，切换设备刷新即见最新进度。
- **两台设备同时答题**：服务端用 revision 乐观锁检测并发；后保存的设备自动"拉取最新记录 -> 合并（作答并集去重、历史考试按 id 去重）-> 重试"，侧栏会提示"已合并其他设备的修改"。
- **同一场进行中的考试**：以服务器已保存的版本为准，另一台设备刷新后继续；**不要在两台设备上同时答同一场考试**，交卷前答案可能互相覆盖。
- localStorage 只是应急副本，服务端文件才是唯一权威存储。

## 安全边界（FR-011-05）

- 应用仅监听 `127.0.0.1`，公网与局域网均无法直连，只有 `tailscale serve` 的代理可达。
- Tailscale Serve 仅对同一 Tailnet 的授权设备可见，未连接 Tailscale 的网络路径完全不可达。
- 不使用 Funnel（不暴露公网）；AI API Key 只在服务端 `local-data/config.json`（gitignore）。

## 验收对照（PRD 四个测试场景）

| 测试 | 操作 | 本实现的保障 |
|---|---|---|
| 一：手机远程刷题 | 手机断 Wi-Fi 用移动数据刷 10 题，回电脑查看 | 同一服务端文件，作答即时保存；多端 409 自动合并（tests/multidevice.test.mjs） |
| 二：错题复习 | 电脑答错 -> 手机错题本可见并复习 | 同上，错题状态由作答历史实时推导 |
| 三：模拟考试 | 手机开考、交卷，电脑查历史 | 快照计分 + 交卷即存；同场考试避免双设备同时作答 |
| 四：数据安全 | 手机退出 Tailscale 后访问 | Serve 仅 Tailnet 可达，无公网路径 |

## 故障排查

| 现象 | 处理 |
|---|---|
| 手机打不开地址 | 电脑是否开机且服务在跑（`curl 127.0.0.1:8765/api/health`）；`tailscale serve status` 是否有输出；手机 Tailscale VPN 是否开启 |
| 证书错误 | 管理后台 HTTPS 证书未开启；或手机 Tailscale 版本过旧 |
| 页面提示"暂时无法加载" | 服务未启动或 serve 失效，重新执行启动脚本；提示文案中已包含检查步骤 |
| 手机端整站 403 / 保存报错 | 旧版 server.py 会拦截 `.ts.net` Host；2026-10-31 起已自动放行 `*.ts.net`（tests/test_tsnethost.py 锁定），如仍出现请升级到含 `host_allowed()` 的版本；非 Tailscale 代理（如 Caddy 自有域名）仍需 `--allowed-host` |
| Mac 重启后服务没了 | 未安装 launchd plist，见上文"开机自启" |
| 两端进度不同步 | 刷新页面；若侧栏显示保存错误，先在数据备份页导出，再按提示合并 |

## Phase 2 兼容性说明

- 前端所有 API 均为**相对路径**（`/api/...`），不依赖 Tailscale 或任何固定域名；第二阶段切换到公网 HTTPS（腾讯云 Caddy 方案，见 dev-docs/guides/2026-10-30-腾讯云部署指南.md）无需改前端。
- 题库、评分、复习核心逻辑与访问通道完全解耦，无需重写。

## 引用说明

- 需求文档：`dev-docs/design/FDE Exam Coach — PRD V1.1 补充需求.md`
- Tailscale Serve 官方文档：https://tailscale.com/kb/1242/tailscale-serve
- Tailscale 下载：https://tailscale.com/download
- PWA Manifest 说明：https://developer.mozilla.org/docs/Web/Progressive_web_apps/Manifest
