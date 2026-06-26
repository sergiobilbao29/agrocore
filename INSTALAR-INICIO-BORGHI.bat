@echo off
REM ============================================================
REM AgroCore BORGHI - Instalar inicio automatico
REM ============================================================
REM Registra una tarea programada de Windows que arranca el
REM backend de Borghi (puerto 3101) al iniciar sesion, completamente
REM oculto. Doble clic aqui UNA SOLA VEZ.
REM
REM Este .bat usa rutas absolutas a C:\AgroCore-Borghi para que
REM puedas correrlo desde cualquier ubicacion.
REM ============================================================

setlocal
set "TASK=AgroCore Borghi Backend"
set "LAUNCHER=C:\AgroCore-Borghi\AgroCore-hidden.vbs"
set "PUERTO=3101"
set "LOGDIR=C:\AgroCore-Borghi\logs"

echo.
echo ============================================================
echo   Instalando AgroCore BORGHI como auto-arranque
echo ============================================================
echo.
echo   Tarea:    %TASK%
echo   Lanzador: %LAUNCHER%
echo   Puerto:   %PUERTO%
echo   Disparador: al iniciar sesion del usuario actual
echo.

REM Verificar que exista el lanzador
if not exist "%LAUNCHER%" (
  echo   [ERROR] No existe %LAUNCHER%
  echo   Asegurate de haber corrido Crear-Cliente.ps1 o SETUP-BORGHI.ps1 primero.
  pause
  exit /b 1
)

REM Verificar Node
set "PATH=%PATH%;%ProgramFiles%\nodejs;%ProgramFiles(x86)%\nodejs;%LOCALAPPDATA%\Programs\nodejs"
where node >nul 2>&1
if errorlevel 1 (
  echo   [ERROR] Node.js no encontrado en PATH.
  pause
  exit /b 1
)

REM Borrar tarea previa si existe (idempotente)
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
echo   Tarea creada. Arrancando AgroCore Borghi ahora en segundo plano...

REM Matar cualquier instancia anterior en el puerto
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%PUERTO%" ^| findstr "LISTENING"') do taskkill /F /PID %%P >nul 2>&1

REM Disparar la tarea ahora (arranque oculto inmediato)
schtasks /Run /TN "%TASK%" >nul 2>&1

REM Esperar a que el puerto responda
set /a tries=0
:wait
set /a tries+=1
timeout /t 1 /nobreak >nul
netstat -ano | findstr ":%PUERTO%" | findstr "LISTENING" >nul
if errorlevel 1 (
  if %tries% LSS 30 goto wait
  echo   [AVISO] El backend no respondio en 30 seg.
  echo   Mira %LOGDIR%\agrocore.log para ver el error.
  goto fin
)

echo   Backend BORGHI listo en http://127.0.0.1:%PUERTO%

:fin
echo.
echo ============================================================
echo   LISTO
echo.
echo   AgroCore Borghi arranca automaticamente con Windows.
echo   - URL publica:  https://borghi.agrocore.ar/app
echo   - URL local:    http://127.0.0.1:%PUERTO%/app
echo   - Log:          %LOGDIR%\agrocore.log
echo   - Para detener: C:\AgroCore-Borghi\CERRAR-AGROCORE.bat
echo ============================================================
echo.
pause
endlocal
