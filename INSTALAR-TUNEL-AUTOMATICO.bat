@echo off
REM ============================================================
REM AgroCore - Instalar tunel cloudflared en inicio automatico
REM ============================================================
REM Registra una tarea programada de Windows que arranca el
REM tunel "agrocore-demo" al iniciar sesion, completamente oculto.
REM Doble clic aqui UNA SOLA VEZ.
REM ============================================================

setlocal
set "HERE=%~dp0"
set "TASK=AgroCore Tunel"
set "LAUNCHER=%HERE%Tunel-hidden.vbs"

echo.
echo ============================================================
echo   Instalando tunel cloudflared como auto-arranque
echo ============================================================
echo.
echo   Tarea:    %TASK%
echo   Lanzador: %LAUNCHER%
echo   Disparador: al iniciar sesion del usuario actual
echo.

REM Verificar que exista el lanzador
if not exist "%LAUNCHER%" (
  echo   [ERROR] No existe %LAUNCHER%
  echo   Verifica que todos los archivos esten en %HERE%
  pause
  exit /b 1
)

REM Verificar cloudflared
where cloudflared >nul 2>&1
if errorlevel 1 (
  echo   [ERROR] cloudflared no encontrado en PATH.
  echo   Instalalo: winget install Cloudflare.cloudflared
  pause
  exit /b 1
)

REM Borrar tarea previa si existe
schtasks /Query /TN "%TASK%" >nul 2>&1
if not errorlevel 1 (
  echo   Quitando tarea previa...
  schtasks /Delete /TN "%TASK%" /F >nul 2>&1
)

REM Crear la tarea: /SC ONLOGON arranca al iniciar sesion (no pide admin)
echo   Creando tarea programada...
schtasks /Create ^
  /TN "%TASK%" ^
  /TR "wscript.exe \"%LAUNCHER%\"" ^
  /SC ONLOGON ^
  /RL LIMITED ^
  /F

if errorlevel 1 (
  echo.
  echo   [ERROR] No se pudo crear la tarea programada.
  pause
  exit /b 1
)

echo.
echo   Tarea creada. Arrancando el tunel ahora en segundo plano...

REM Disparar la tarea ahora
schtasks /Run /TN "%TASK%" >nul 2>&1

echo.
echo ============================================================
echo   LISTO
echo.
echo   El tunel arranca automaticamente con Windows.
echo   - Demo publico:  https://demo.agrocore.ar
echo   - Log:           %HERE%logs\tunel.log
echo   - Para detener:  DETENER-TUNEL.bat
echo   - Para desinstalar: DESINSTALAR-TUNEL-AUTOMATICO.bat
echo ============================================================
echo.
pause
endlocal
