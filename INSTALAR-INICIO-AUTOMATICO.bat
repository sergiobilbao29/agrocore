@echo off
REM ============================================================
REM AgroCore - Instalar inicio automatico (tarea programada)
REM ============================================================
REM Registra una tarea programada de Windows que arranca AgroCore
REM al iniciar sesion, completamente oculto, sin requerir accion
REM del usuario. Doble clic aqui UNA SOLA VEZ.
REM ============================================================

setlocal
set "HERE=%~dp0"
set "TASK=AgroCore Backend"
set "LAUNCHER=%HERE%AgroCore-hidden.vbs"

echo.
echo ============================================================
echo   Instalando AgroCore como servicio de inicio
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

REM Verificar Node
set "PATH=%PATH%;%ProgramFiles%\nodejs;%ProgramFiles(x86)%\nodejs;%LOCALAPPDATA%\Programs\nodejs"
where node >nul 2>&1
if errorlevel 1 (
  echo   [ERROR] Node.js no encontrado en PATH.
  echo   Instalalo primero desde https://nodejs.org
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
echo   Tarea creada. Arrancando AgroCore ahora en segundo plano...

REM Matar cualquier instancia anterior
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":3100" ^| findstr "LISTENING"') do taskkill /F /PID %%P >nul 2>&1

REM Disparar la tarea ahora (arranque oculto inmediato)
schtasks /Run /TN "%TASK%" >nul 2>&1

REM Esperar a que el puerto responda
set /a tries=0
:wait
set /a tries+=1
timeout /t 1 /nobreak >nul
netstat -ano | findstr ":3100" | findstr "LISTENING" >nul
if errorlevel 1 (
  if %tries% LSS 30 goto wait
  echo   [AVISO] El backend no respondio en 30 seg.
  echo   Mira %HERE%logs\agrocore.log para ver el error.
  goto fin
)

echo   Backend listo en http://127.0.0.1:3100
echo   Abriendo navegador...
start "" "http://127.0.0.1:3100/app"

:fin
echo.
echo ============================================================
echo   LISTO
echo.
echo   AgroCore ahora arranca automaticamente con Windows.
echo   - Para entrar:  http://127.0.0.1:3100/app  (guardalo como favorito)
echo   - Log:          %HERE%logs\agrocore.log
echo   - Para detener: DETENER-AGROCORE.bat
echo   - Para desinstalar el auto-inicio: DESINSTALAR-INICIO-AUTOMATICO.bat
echo ============================================================
echo.
pause
endlocal