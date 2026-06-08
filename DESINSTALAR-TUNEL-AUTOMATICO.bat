@echo off
REM ============================================================
REM AgroCore - Desinstalar auto-arranque del tunel cloudflared
REM ============================================================

setlocal
set "TASK=AgroCore Tunel"

echo.
echo ============================================================
echo   Desinstalando auto-arranque del tunel
echo ============================================================
echo.

REM Detener tunel actual
echo   Deteniendo cloudflared (si esta corriendo)...
taskkill /F /IM cloudflared.exe >nul 2>&1

REM Borrar tarea
echo   Quitando tarea programada...
schtasks /Query /TN "%TASK%" >nul 2>&1
if errorlevel 1 (
  echo     No habia tarea registrada.
) else (
  schtasks /Delete /TN "%TASK%" /F
  echo     Tarea eliminada.
)

echo.
echo ============================================================
echo   Listo. El tunel ya no arrancara con Windows.
echo   Para volver a activarlo: doble clic en
echo   INSTALAR-TUNEL-AUTOMATICO.bat
echo ============================================================
echo.
pause
endlocal
