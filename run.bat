@echo off
title Nino Bot - RPG Engine v3.6
cd /d %~dp0
echo.
echo  ============================================
echo    NINO RPG ENGINE ULTIMATE EDITION v3.6
echo  ============================================
echo  [*] Dang khoi dong bot...
echo  [*] Dashboard se chay tai: http://localhost:3000
echo.
start "" "http://localhost:3000"
node nino.js
pause
