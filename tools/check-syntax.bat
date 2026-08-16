@echo off
cd /d "%~dp0.."
node --check main.js
echo CHECK_EXIT=%ERRORLEVEL%
