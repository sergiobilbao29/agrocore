@echo off
REM ============================================================
REM AgroCore - Diagnostico de conectividad LAN
REM ============================================================
REM Chequea todo lo necesario para que AgroCore sea accesible
REM desde otras PCs/celulares en la red local.
REM ============================================================

setlocal EnableDelayedExpansion

echo.
echo ============================================================
echo   DIAGNOSTICO DE RED AgroCore
echo ============================================================
echo.

echo [1/6] Node.js corriendo en puerto 3100?
echo ------------------------------------------
netstat -ano | findstr ":3100" | findstr "LISTENING"
netstat -ano | findstr ":3100" | findstr "LISTENING" >nul
if errorlevel 1 (
  echo   [ERROR] AgroCore NO esta corriendo.
  echo   Solucion: doble clic en AgroCore.bat
) else (
  echo   OK - el servidor escucha.
)
echo.

echo [2/6] En que interfaces escucha?
echo ------------------------------------------
netstat -an | findstr ":3100" | findstr "LISTENING"
echo   (deberia decir 0.0.0.0:3100 para aceptar conexiones LAN;
echo    si dice 127.0.0.1:3100 solo acepta conexiones locales.)
echo.

echo [3/6] Regla de firewall para el puerto 3100?
echo ------------------------------------------
netsh advfirewall firewall show rule name="AgroCore TCP 3100" 2>nul | findstr /C:"Enabled" /C:"Profile" /C:"Action" /C:"LocalPort"
netsh advfirewall firewall show rule name="AgroCore TCP 3100" >nul 2>&1
if errorlevel 1 (
  echo   [ADVERTENCIA] No hay regla de firewall.
  echo   Solucion: clic derecho en ABRIR-PUERTO-3100.bat ^> Ejecutar como administrador.
) else (
  echo   OK - regla presente.
)
echo.

echo [4/6] Perfil de tu red WiFi / LAN
echo ------------------------------------------
powershell -NoProfile -Command "Get-NetConnectionProfile | Format-Table Name, NetworkCategory, IPv4Connectivity -Auto" 2>nul
echo   (si esta como 'Public' el firewall bloqueara LAN aunque
echo    tengas la regla; cambiala a 'Private' en Configuracion.)
echo.

echo [5/6] IPs locales de esta PC
echo ------------------------------------------
for /f "tokens=2 delims=:" %%i in ('ipconfig ^| findstr /C:"IPv4"') do (
  for /f "tokens=*" %%j in ("%%i") do echo   http://%%j:3100/app
)
echo.

echo [6/6] Test HTTP local
echo ------------------------------------------
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3100/api/health' -TimeoutSec 3; Write-Host '  OK - ' $r.StatusCode ' ' $r.StatusDescription } catch { Write-Host '  [ERROR]' $_.Exception.Message }"
echo.

echo ============================================================
echo   Si todo dice OK aca pero la otra PC no conecta:
echo   - Verificar que ambas esten en la MISMA WiFi/LAN.
echo   - Desactivar temporalmente el antivirus de la otra PC.
echo   - Probar un 'ping ^<IP-de-esta-PC^>' desde la otra PC.
echo ============================================================
echo.
pause
endlocal