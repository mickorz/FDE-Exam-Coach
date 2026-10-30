@echo off
rem 日常发布：推送代码并让服务器拉取重启。用法：deploy.bat 用户名@服务器IP
rem 前提：已完成 setup-server.sh 初始化，且本机 ssh 可免密登录服务器（ssh-copy-id）。
set TARGET=%1
if "%TARGET%"=="" (
  echo 用法: deploy.bat 用户名@服务器IP
  exit /b 1
)
cd /d "%~dp0.."
git pull --rebase origin main || goto :err
git push origin main || goto :err
ssh %TARGET% "cd /opt/fde-exam-coach && git pull --ff-only && sudo systemctl restart fde-coach && systemctl is-active fde-coach"
if errorlevel 1 goto :err
echo.
echo 发布完成：https 域名已生效（详见 deploy 目录说明）
goto :eof
:err
echo 发布失败：请先处理 git 同步或 SSH 问题
exit /b 1
