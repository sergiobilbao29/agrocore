@echo off
REM ============================================================
REM Helper interno - arranca el backend SIN ventana visible.
REM NO hacer doble clic aqui. Se invoca desde AgroCore-hidden.vbs
REM (que a su vez puede llamarse por tarea programada o por
REM doble clic en INSTALAR-INICIO-AUTOMATICO.bat).
REM ============================================================

set "HERE=%~dp0"
if not exist "%HERE%logs" mkdir "%HERE%logs" 2>nul
set "PATH=%PATH%;%ProgramFiles%\nodejs;%ProgramFiles(x86)%\nodejs;%LOCALAPPDATA%\Programs\nodejs;%APPDATA%\npm"

REM Si ya hay algo en 3100, no pisarlo. Salir silencioso.
netstat -ano | findstr ":3100" | findstr "LISTENING" >nul
if not errorlevel 1 exit /b 0

echo. >> "%HERE%logs\agrocore.log"
echo === AgroCore arranque %DATE% %TIME% === >> "%HERE%logs\agrocore.log"

cd /d "%HERE%backend"
node src/server.js >> "%HERE%logs\agrocore.log" 2>&1
echo === Node termino con %errorlevel% %DATE% %TIME% === >> "%HERE%logs\agrocore.log"