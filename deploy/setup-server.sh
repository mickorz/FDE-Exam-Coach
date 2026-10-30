#!/usr/bin/env bash
# 腾讯云服务器一次性初始化（Ubuntu/Debian）。用法：
#   sudo bash deploy/setup-server.sh 你的域名
# 前提：域名已备案、A 记录已指向本机、安全组已放行 80/443。
set -euo pipefail
DOMAIN=${1:?用法: sudo bash setup-server.sh 你的域名}
APP_DIR=/opt/fde-exam-coach
REPO=https://github.com/mickorz/FDE-Exam-Coach.git
RUN_USER=${SUDO_USER:-$USER}
cd "$(dirname "$0")/.."

echo "[1/6] 安装基础软件：git python3 Caddy"
apt-get update -qq
apt-get install -y git python3 curl debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
apt-get update -qq && apt-get install -y caddy

echo "[2/6] 拉取代码到 $APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone "$REPO" "$APP_DIR"
fi
chown -R "$RUN_USER":"$RUN_USER" "$APP_DIR"

echo "[3/6] 设置网站访问密码（浏览器打开站点时输入）"
read -rp "访问用户名: " AUTH_USER
read -rsp "访问密码: " AUTH_PASS; echo
AUTH_HASH=$(caddy hash-password --plain "$AUTH_PASS")

echo "[4/6] 安装 systemd 服务（开机自启 + 崩溃自动重启）"
sed -e "s/__DOMAIN__/$DOMAIN/g" -e "s/__USER__/$RUN_USER/g" deploy/fde-coach.service > /etc/systemd/system/fde-coach.service
systemctl daemon-reload
systemctl enable --now fde-coach

echo "[5/6] 配置 Caddy 站点（自动 HTTPS）"
sed -e "s/__DOMAIN__/$DOMAIN/g" -e "s/__AUTH_USER__/$AUTH_USER/g" -e "s/__AUTH_HASH__/$AUTH_HASH/g" deploy/Caddyfile > /etc/caddy/Caddyfile
systemctl reload caddy

echo "[6/6] 允许 $RUN_USER 免密重启服务（日常发布用）"
echo "$RUN_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart fde-coach" > /etc/sudoers.d/fde-coach
chmod 440 /etc/sudoers.d/fde-coach

echo
echo "部署完成：https://$DOMAIN"
echo "后续 AI 讲解配置（可选）：在 $APP_DIR/app/local-data/ 复制 config.json.example 为 config.json 并填入 Key"
echo "每日数据备份建议：crontab 加一行 tar 打包 $APP_DIR/app/local-data/"
