@echo off
chcp 65001 >nul
setlocal
set "APP_EXE=%~dp0release\v0.6.31\win-unpacked\부동산 도우미.exe"
if not exist "%APP_EXE%" (
  echo 실행 파일이 없습니다: "%APP_EXE%"
  pause
  exit /b 1
)
start "" "%APP_EXE%"
