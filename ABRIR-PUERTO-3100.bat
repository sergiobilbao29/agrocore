@echo off
REM ============================================================
REM AgroCore - Abrir puerto 3100 en el Firewall de Windows
REM ============================================================
REM Permite que otras PCs y celulares en la misma red WiFi/LAN
REM se conecten a AgroCore (http://<IP-DE-ESTA-PC>:3100/app).
REM
REM AUTO-ELEVACION: si no lo corres como administrador, el propio
REM script se relanza pidiendo permisos UAC.
REM Ejecutar UNA SOLA VEZ.
REM ============================================================

REM --- Auto-elevacion a administrador ---
net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Se necesitan permisos de administrador. Pidiendolos...
  REM Relanzar el script con UAC
  powershell -NoProfile -Command "Start-Process '%~f0' -Verb RunAs"
  exit /b 0
)

echo.
echo ============================================================
echo   AgroCore - Abriendo puerto 3100 en el Firewall
echo ============================================================
echo.

REM Borrar regla previa si existe (idempotente)
netsh advfirewall firewall delete rule name="AgroCore (TCP 3100)" >nul 2>&1
netsh advfirewall firewall delete rule name="AgroCore TCP 3100" >nul 2>&1

REM Agregar regla de inbound en TODOS los perfiles (privado+dominio+publico)
REM Si tu red esta marcada como "publica", esto es lo unico que hace que funcione.
netsh advfirewall firewall add rule name="AgroCore TCP 3100" dir=in action=allow protocol=TCP localport=3100 profile=any description="Permitir conexiones LAN a AgroCore"

if errorlevel 1 (
  echo.
  echo   [ERROR] No se pudo agregar la regla al firewall.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo   Regla de Firewall creada correctamente.
echo ============================================================
echo.

REM Tambien asegurarse que el perfil de red no sea 'publico' y bloquee todo igual.
REM En Windows 10/11 es mejor tener la WiFi como "Privada" para LAN.

echo   Perfil de red actual:
powershell -NoProfile -Command "Get-NetConnectionProfile | Format-Table Name, NetworkCategory, IPv4Connectivity -Auto" 2>nul

echo.
echo   IPs locales de esta PC:
for /f "tokens=2 delims=:" %%i in ('ipconfig ^| findstr /C:"IPv4"') do (
  for /f "tokens=*" %%j in ("%%i") do echo     http://%%j:3100/app
)
echo.
echo   Probale con cualquiera de esas URLs desde otra PC o celular
echo   en la MISMA red WiFi.
echo.
echo   Si sigue sin funcionar, tu red WiFi puede estar marcada como
echo   "Publica" en Windows. Para cambiarla:
echo   Configuracion -^> Red -^> (tu WiFi) -^> Perfil de red = "Privada".
echo.
echo ============================================================
echo.
pause