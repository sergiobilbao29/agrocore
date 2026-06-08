@echo off
REM ============================================================
REM AgroCore - Desinstalar inicio automatico
REM ============================================================
REM Borra la tarea programada y detiene el backend.
REM ============================================================

setlocal
set "TASK=AgroCore Backend"

echo.
echo ============================================================
echo   Desinstalando auto-inicio de AgroCore
echo ============================================================
echo.

REM Detener backend actual
echo   Deteniendo backend (si esta corriendo)...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":3100" ^| findstr "LISTENING"') do (
  echo     Cerrando PID %%P
  taskkill /F /PID %%P >nul 2>&1
)

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
echo   Listo. AgroCore ya no arrancara con Windows.
echo   Los archivos y datos siguen intactos. Para volver a
echo   activarlo: doble clic en INSTALAR-INICIO-AUTOMATICO.bat
echo ============================================================
echo.
pause
endlocal