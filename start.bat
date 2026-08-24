@echo off
:: ============================================================
::  Facebook Live Product System — Start All Services
::  Delegates to start.ps1 which uses pm2 so the server
::  keeps running after this window closes.
:: ============================================================

title Facebook Live Product System

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
