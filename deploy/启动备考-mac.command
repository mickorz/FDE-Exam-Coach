#!/bin/bash
# FDE Exam Coach macOS 启动（Mac mini 备考服务器，FR-011）
# 双击运行：启动服务（已在运行则跳过）并配置 Tailscale 手机访问代理。
cd "$(dirname "$0")/../app" || exit 1
mkdir -p local-data

if curl -s --max-time 2 http://127.0.0.1:8765/api/health >/dev/null 2>&1; then
  echo "备考服务已在运行（http://127.0.0.1:8765）"
else
  nohup python3 server.py --port 8765 >> local-data/server.log 2>&1 &
  sleep 1
  if curl -s --max-time 2 http://127.0.0.1:8765/api/health >/dev/null 2>&1; then
    echo "备考服务已启动，日志见 app/local-data/server.log"
  else
    echo "启动失败，请查看 app/local-data/server.log"; exit 1
  fi
fi

# Tailscale 手机访问代理（未安装 Tailscale 则提示后跳过）
if command -v tailscale >/dev/null 2>&1; then
  tailscale serve --bg 8765
  echo "手机访问地址（同一 Tailnet 内打开）："
  tailscale serve status
else
  echo "未检测到 Tailscale：手机远程访问请先安装并登录 Tailscale（https://tailscale.com）"
fi
