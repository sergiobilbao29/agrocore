@echo off
REM ============================================================
REM AgroCore - Detener backend
REM ============================================================
REM Detiene la instancia que este corriendo en el puerto 3100.
REM Si el auto-inicio esta activo, volvera a arrancar la proxima
REM vez que inicies sesion en Windows.
REM ============================================================

echo.
echo Deteniendo AgroCore...
set "found="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":3100" ^| findstr "LISTENING"') do (
  set "found=1"
  echo   Cerrando PID %%P
  taskkill /F /PID %%P >nul 2>&1
)
if not defined found (
  echo   No habia ninguna instancia corriendo.
) else (
  echo   Detenido.
)
echo.
timeout /t 2 /nobreak >nul