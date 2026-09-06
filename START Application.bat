@echo off
title Facebook Live POS
color 0b
echo ============================================================
echo   Starting Facebook Live Product System...
echo ============================================================
cd /d "%~dp0"
node "%~dp0node_modules\electron\cli.js" "%~dp0."
