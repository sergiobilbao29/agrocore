@echo off
REM ============================================================
REM Helper interno - arranca el tunel cloudflared SIN ventana visible.
REM NO hacer doble clic aqui. Se invoca desde Tunel-hidden.vbs.
REM ============================================================

if not exist "%~dp0logs" mkdir "%~dp0logs" 2>nul

echo. >> "%~dp0logs\tunel.log"
echo === Tunel arranque %DATE% %TIME% === >> "%~dp0logs\tunel.log"

cloudflared tunnel run agrocore-demo >> "%~dp0logs\tunel.log" 2>&1
echo === Tunel termino con %errorlevel% %DATE% %TIME% === >> "%~dp0logs\tunel.log"
