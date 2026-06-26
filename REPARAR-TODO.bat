@echo off
REM ============================================================
REM AgroCore - REPARAR-TODO
REM ------------------------------------------------------------
REM Verifica y levanta lo que se haya caido:
REM   - Backend Demo (puerto 3100)
REM   - Backend Borghi (puerto 3101)
REM   - Tunel cloudflared
REM
REM Util para correr cuando se cae algo o despues de reiniciar.
REM No necesita admin (solo ejecuta tareas existentes).
REM ============================================================

setlocal

echo.
echo ============================================================
echo   AgroCore - Reparar todo lo que este caido
echo ============================================================
echo.

REM ----- Demo backend (3100) -----
netstat -ano | findstr ":3100" | findstr "LISTENING" >nul
if errorlevel 1 (
  echo [Demo backend] CAIDO. Levantando...
  schtasks /Run /TN "AgroCore Backend" >nul 2>&1
  if errorlevel 1 (
    REM Fallback: arrancarlo directo via VBS
    wscript.exe "C:\AgroCore\AgroCore-hidden.vbs"
  )
) else (
  echo [Demo backend] OK ya esta corriendo en 3100
)

REM ----- Borghi backend (3101) - corre como servicio Windows via NSSM -----
netstat -ano | findstr ":3101" | findstr "LISTENING" >nul
if errorlevel 1 (
  echo [Borghi backend] CAIDO. Levantando servicio AgroCore-Borghi...
  sc start AgroCore-Borghi >nul 2>&1
  if errorlevel 1 (
    echo   [AVISO] No se pudo iniciar el servicio. Verifica con: Get-Service AgroCore-Borghi
  )
) else (
  echo [Borghi backend] OK ya esta corriendo en 3101
)

REM ----- Cloudflared -----
tasklist /FI "IMAGENAME eq cloudflared.exe" 2>nul | findstr /I "cloudflared.exe" >nul
if errorlevel 1 (
  echo [Tunel cloudflared] CAIDO. Levantando...
  schtasks /Run /TN "AgroCore Tunel" >nul 2>&1
  if errorlevel 1 (
    REM Fallback: arrancarlo directo via VBS
    wscript.exe "C:\AgroCore\Tunel-hidden.vbs"
  )
) else (
  echo [Tunel cloudflared] OK ya esta corriendo
)

echo.
echo Esperando 8 segundos para verificar...
timeout /t 8 /nobreak >nul

echo.
echo ============================================================
echo   ESTADO FINAL:
echo ============================================================
echo.
echo Puertos LISTENING (debe haber 3100 y 3101):
netstat -ano | findstr "LISTENING" | findstr ":31"
echo.
echo Procesos cloudflared (debe haber 1):
tasklist /FI "IMAGENAME eq cloudflared.exe" 2>nul | findstr /I "cloudflared.exe"
echo.
echo ============================================================
echo   URLs:
echo   - Demo:    https://demo.agrocore.ar/app
echo   - Borghi:  https://borghi.agrocore.ar/app
echo ============================================================
echo.
pause
endlocal
