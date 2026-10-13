@echo off
chcp 65001 >nul
title Gestao do Posto
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js nao encontrado. Instale a versao LTS em https://nodejs.org e abra este arquivo de novo.
  echo.
  pause
  exit /b 1
)
start "" http://localhost:3000
node --no-warnings server\index.js
pause
