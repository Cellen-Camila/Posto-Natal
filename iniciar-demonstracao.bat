@echo off
chcp 65001 >nul
title Gestao do Posto - DEMONSTRACAO
cd /d "%~dp0"
start "" http://localhost:3000
node --no-warnings server\index.js --demo
pause
