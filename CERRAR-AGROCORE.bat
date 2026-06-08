@echo off
REM ============================================================
REM  CERRAR AGROCORE
REM  Cierra SOLO el servidor de AgroCore (el que escucha en el
REM  puerto 3100). NO toca otros procesos de Node, asi que tu
REM  sistema del puerto 3000 sigue funcionando sin problemas.
REM ============================================================
setlocal enabledelayedexpansion
set PUERTO=3100
set ENCONTRADO=0

echo.
echo  Buscando el servidor de AgroCore en el puerto %PUERTO% ...
echo.

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PUERTO%" ^| findstr "LISTENING"') do (
    set ENCONTRADO=1
    echo    - Cerrando proceso PID %%a ...
    taskkill /F /PID %%a >nul 2>&1
)

echo.
if "%ENCONTRADO%"=="0" (
    echo  No se encontro AgroCore corriendo en el puerto %PUERTO%.
    echo  Puede que ya estuviera cerrado.
) else (
    echo  AgroCore cerrado correctamente.
    echo  Tu otro sistema del puerto 3000 sigue intacto.
)
echo.
echo  Ya podes correr la actualizacion de la base de datos.
echo.
pause
