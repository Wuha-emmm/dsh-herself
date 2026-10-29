@echo off
chcp 65001 >nul
rem 快速启动：交给 boot.ps1（默认 SnowLuma 运行时；回滚 NapCat 用 DSH_QQ_RUNTIME=napcat）
powershell -ExecutionPolicy Bypass -File "%~dp0boot.ps1" %*
