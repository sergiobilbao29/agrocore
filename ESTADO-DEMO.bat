@echo off
REM ============================================================
REM AgroCore - Estado del Demo (demo.agrocore.ar)
REM ============================================================
REM Diagnostico rapido de los 3 componentes que mantienen vivo
REM el demo publico:
REM   1. Backend Node.js corriendo en localhost:3100
REM   2. Servicio cloudflared (tunel agrocore-demo)
REM   3. Conectividad publica de demo.agrocore.ar
REM ============================================================

setlocal EnableDelayedExpansion
title AgroCore - Estado del Demo
color 0A

echo.
echo ============================================================
echo   ESTADO DEL DEMO  -  demo.agrocore.ar
echo ============================================================
echo.

REM ------------------------------------------------------------
REM 1) Backend Node.js en puerto 3100
REM ------------------------------------------------------------
echo [1/3] Backend Node.js (puerto 3100)
echo ------------------------------------------
netstat -ano | findstr ":3100" | findstr "LISTENING" >nul
if errorlevel 1 (
  echo   [ERROR] El backend NO esta corriendo.
  echo   Solucion: doble clic en AgroCore.bat
  set "backend_ok=0"
) else (
  for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":3100" ^| findstr "LISTENING"') do (
    echo   OK - Node escuchando en :3100  (PID %%P)
  )
  set "backend_ok=1"
)
echo.

REM ------------------------------------------------------------
REM 2) Servicio cloudflared (tunel agrocore-demo)
REM ------------------------------------------------------------
echo [2/3] Servicio cloudflared (tunel)
echo ------------------------------------------
sc query cloudflared >nul 2>&1
if errorlevel 1 (
  echo   [INFO] El servicio cloudflared NO esta instalado como servicio.
  echo   Si lo estas corriendo a mano (cloudflared tunnel run agrocore-demo)
  echo   tambien funciona, pero conviene instalarlo como servicio:
  echo     PowerShell admin -^> cloudflared service install
  set "tunnel_ok=?"
) else (
  for /f "tokens=4" %%S in ('sc query cloudflared ^| findstr /C:"STATE"') do set "tunnel_state=%%S"
  if /i "!tunnel_state!"=="RUNNING" (
    echo   OK - Servicio cloudflared en estado RUNNING.
    set "tunnel_ok=1"
  ) else (
    echo   [ERROR] Servicio cloudflared NO esta en RUNNING.
    echo   Solucion: PowerShell admin -^> Start-Service cloudflared
    set "tunnel_ok=0"
  )
)
echo.

REM ------------------------------------------------------------
REM 3) Conectividad publica - test HTTP a demo.agrocore.ar
REM ------------------------------------------------------------
echo [3/3] Conectividad publica
echo ------------------------------------------
echo   Pidiendo https://demo.agrocore.ar/api/health ...
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'https://demo.agrocore.ar/api/health' -TimeoutSec 6; Write-Host '  OK -' $r.StatusCode $r.StatusDescription } catch { Write-Host '  [ERROR]' $_.Exception.Message }"
echo.

REM ------------------------------------------------------------
REM URLs y referencias
REM ------------------------------------------------------------
echo ============================================================
echo   URLs
echo ============================================================
echo.
echo   Demo publico:        https://demo.agrocore.ar/app
echo   Demo (raiz redir):   https://demo.agrocore.ar
echo   Local (esta PC):     http://127.0.0.1:3100/app
echo   Landing publica:     https://agrocore.ar
echo.
echo ============================================================
echo   Si los 3 chequeos dieron OK, el demo esta operativo.
echo ============================================================
echo.
pause
endlocal
