@echo off
title FB Live Shop — Public QR Tunnel
PowerShell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-ngrok.ps1"
pause
