@echo off
REM ============================================================
REM AgroCore - Abrir AgroCore en el navegador
REM ============================================================
REM Si el backend esta corriendo (porque instalaste el auto-inicio
REM o porque lo arrancaste antes), abre el navegador en la UI.
REM Si NO esta corriendo, lo arranca oculto en segundo plano y
REM despues abre el navegador.
REM ============================================================

setlocal
set "HERE=%~dp0"
set "PATH=%PATH%;%ProgramFiles%\nodejs;%ProgramFiles(x86)%\nodejs;%LOCALAPPDATA%\Programs\nodejs"

REM Chequear si el backend ya responde
netstat -ano | findstr ":3100" | findstr "LISTENING" >nul
if not errorlevel 1 (
  REM Ya esta corriendo: abrir navegador y salir
  start "" "http://127.0.0.1:3100/app"
  endlocal
  exit /b 0
)

REM No esta corriendo: lanzar oculto via VBS
if exist "%HERE%AgroCore-hidden.vbs" (
  wscript.exe "%HERE%AgroCore-hidden.vbs"
) else (
  REM Fallback: si falta el vbs, lo lanzamos con start /MIN
  start "AgroCore Backend" /MIN cmd /c "%HERE%_AgroCore-hidden.cmd"
)

REM Esperar al puerto y abrir navegador
set /a tries=0
:wait
set /a tries+=1
timeout /t 1 /nobreak >nul
netstat -ano | findstr ":3100" | findstr "LISTENING" >nul
if errorlevel 1 (
  if %tries% LSS 25 goto wait
  echo.
  echo No se pudo arrancar AgroCore. Mira logs\agrocore.log
  pause
  endlocal
  exit /b 1
)

start "" "http://127.0.0.1:3100/app"
endlocal