@echo off
REM ============================================================
REM AgroCore - Detener tunel cloudflared
REM ============================================================

echo.
echo Deteniendo tunel cloudflared...
taskkill /F /IM cloudflared.exe >nul 2>&1
if errorlevel 1 (
  echo   No habia tunel corriendo.
) else (
  echo   Detenido.
)
echo.
echo   Si tenes el auto-arranque instalado, volvera a arrancar
echo   la proxima vez que inicies sesion en Windows.
echo.
timeout /t 2 /nobreak >nul
