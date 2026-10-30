@echo off
rem FDE Exam Coach 本地启动脚本（Windows）
rem 学习记录保存在 app\local-data\，AI 配置见 app\local-data\config.json.example
cd /d "%~dp0app"
where py >nul 2>nul && (py -3 server.py %*) || (python server.py %*)
pause
