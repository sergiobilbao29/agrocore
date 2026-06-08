@echo off
REM ============================================================
REM  INICIO AUTOMATICO DE AGROCORE
REM  Hace que AgroCore arranque solo (en segundo plano, sin
REM  ventana) cada vez que inicies sesion en esta PC.
REM ============================================================
set STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup

echo.
echo  Configurando el inicio automatico de AgroCore...
copy /Y "C:\AgroCore\INICIAR-AGROCORE.vbs" "%STARTUP%\INICIAR-AGROCORE.vbs" >nul

if exist "%STARTUP%\INICIAR-AGROCORE.vbs" (
    echo.
    echo  LISTO. AgroCore va a arrancar solo, en segundo plano,
    echo  cada vez que prendas la PC e inicies sesion en Windows.
    echo.
    echo  Para desactivarlo, borra este archivo:
    echo  %STARTUP%\INICIAR-AGROCORE.vbs
) else (
    echo.
    echo  No se pudo configurar. Revisa que exista el archivo
    echo  C:\AgroCore\INICIAR-AGROCORE.vbs
)
echo.
pause
