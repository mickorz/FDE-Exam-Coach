@echo off
rem FDE Exam Coach 本地启动脚本（Windows）
rem 学习记录保存在 app\local-data\，AI 配置见 app\local-data\config.json.example
cd /d "%~dp0app"
rem Tailscale 手机访问代理（FR-011），未安装 Tailscale 则跳过
where tailscale >nul 2>nul && tailscale serve --bg 8765
where py >nul 2>nul && (py -3 server.py %*) || (python server.py %*)
pause
