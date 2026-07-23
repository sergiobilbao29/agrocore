# ============================================================
#  AgroCore - Crear instancia para un cliente nuevo
# ------------------------------------------------------------
#  Crea TODO lo necesario para que un cliente nuevo pueda
#  usar AgroCore desde un subdominio:
#
#    1. Carpeta C:\AgroCore-<Cliente> (clon del repo actual)
#    2. Base de datos PostgreSQL agrocore_<cliente>
#    3. .env con DATABASE_URL + PORT unico
#    4. npm install + prisma migrate deploy + prisma generate
#    5. Lanzador VBS (igual al de Demo, en background)
#    6. _helpers .cmd
#    7. Te imprime los pasos manuales finales (tunel + DNS)
#
#  USO:
#    .\Crear-Cliente.ps1 -Cliente "Borghi" -Puerto 3101
#
#  PARAMETROS:
#    -Cliente       Nombre del cliente (sin espacios). Ej "Borghi"
#    -Puerto        Puerto local libre. Por defecto 3101.
#    -PasswordDB    Password del usuario 'agrocore' en Postgres.
#                   Por defecto el mismo de Demo: agrocore_dev_2026
#    -SinInstalar   Saltea npm install (usar si ya esta hecho)
# ============================================================

param(
  [Parameter(Mandatory=$true)]
  [string]$Cliente,

  [int]$Puerto = 3101,
  [string]$PasswordDB = "agrocore_dev_2026",
  [switch]$SinInstalar
)

# NO usamos $ErrorActionPreference = "Stop" globalmente porque npm y otros
# escriben WARNINGS a stderr y PowerShell los toma como excepciones fatales.
# Manejamos errores manualmente con $LASTEXITCODE / try-catch donde hace falta.
$ErrorActionPreference = "Continue"

# ---------- Validaciones ----------
$ClienteLower = $Cliente.ToLower()
$Carpeta      = "C:\AgroCore-$Cliente"
$DBName       = "agrocore_$ClienteLower"
$TunelName    = "agrocore-$ClienteLower"
$Subdominio   = "$ClienteLower.agrocore.ar"
$RepoOrigen   = "C:\AgroCore"

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  AgroCore - Setup de instancia: $Cliente" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Carpeta destino : $Carpeta"
Write-Host "  Puerto local    : $Puerto"
Write-Host "  Base de datos   : $DBName"
Write-Host "  Subdominio      : $Subdominio"
Write-Host "  Tunel Cloudflare: $TunelName"
Write-Host ""

# MODO RESUME: si la carpeta ya existe, asumimos que estamos retomando un setup
# que se interrumpio. Saltea los pasos que ya estaban hechos.
$Resume = $false
if (Test-Path $Carpeta) {
  Write-Host "[INFO] La carpeta '$Carpeta' ya existe. Modo RESUME activado." -ForegroundColor Cyan
  Write-Host "       Se saltearan los pasos ya completados (clonar, .env, etc)." -ForegroundColor Cyan
  $Resume = $true
}

# Verificar puerto libre (solo si NO estamos en resume, o si esta libre)
$enUso = netstat -ano | Select-String ":$Puerto" | Select-String "LISTENING"
if ($enUso -and -not $Resume) {
  Write-Host "[ERROR] El puerto $Puerto ya esta en uso. Usa otro con -Puerto" -ForegroundColor Red
  exit 1
}

# Verificar repo origen
if (-not (Test-Path "$RepoOrigen\backend\src\server.js")) {
  Write-Host "[ERROR] No encuentro C:\AgroCore. Necesito el repo origen." -ForegroundColor Red
  exit 1
}

# ---------- 1. Clonar carpeta ----------
if ($Resume -and (Test-Path "$Carpeta\backend\src\server.js")) {
  Write-Host "[1/7] (skip) Carpeta ya clonada" -ForegroundColor DarkGray
} else {
  Write-Host "[1/7] Clonando carpeta de AgroCore (puede tardar)..." -ForegroundColor Yellow
  # Usamos robocopy, salteamos node_modules (lo reinstalamos limpio)
  robocopy $RepoOrigen $Carpeta /E /XD node_modules .git logs uploads /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
  if (-not (Test-Path "$Carpeta\backend\src\server.js")) {
    Write-Host "[ERROR] Robocopy no copio bien la carpeta." -ForegroundColor Red
    exit 1
  }
  Write-Host "      OK carpeta clonada" -ForegroundColor Green
}

# ---------- 2. Crear base de datos ----------
Write-Host "[2/7] Creando base PostgreSQL '$DBName'..." -ForegroundColor Yellow
$env:PGPASSWORD = $PasswordDB
# Intento crear; si ya existe, solo aviso. cmd /c evita stderr -> excepcion.
cmd /c "psql -U agrocore -h localhost -d postgres -c `"CREATE DATABASE \`"$DBName\`";`" 2>&1" | Out-Null
if ($LASTEXITCODE -eq 0) {
  Write-Host "      OK base creada" -ForegroundColor Green
} else {
  Write-Host "      [AVISO] La base ya existia o hubo un error (exit $LASTEXITCODE). Si ya existia, sigue normal." -ForegroundColor Yellow
}

# ---------- 3. Generar .env ----------
if ($Resume -and (Test-Path "$Carpeta\backend\.env")) {
  Write-Host "[3/7] (skip) .env ya existe" -ForegroundColor DarkGray
} else {
Write-Host "[3/7] Generando .env..." -ForegroundColor Yellow
$jwtSecret = "agrocore-$ClienteLower-" + ([Guid]::NewGuid().ToString("N"))
$envContent = @"
# Conexion a PostgreSQL local
DATABASE_URL="postgresql://agrocore:$PasswordDB@localhost:5432/$DBName`?schema=public"

# Secreto para firmar tokens JWT (UNICO por instancia)
JWT_SECRET="$jwtSecret"

# Puerto local
PORT=$Puerto

# CORS
CORS_ORIGIN="*"
AGROCORE_REPO=sergiobilbao29/agrocore

# Identificador de instancia (visible en UI/logs)
AGROCORE_INSTANCIA="$Cliente"
"@
$envContent | Out-File -FilePath "$Carpeta\backend\.env" -Encoding utf8 -NoNewline
Write-Host "      OK .env generado" -ForegroundColor Green
}

# ---------- 4. Copiar node_modules de Demo ----------
# OJO: NO hacer 'npm install' porque la registry tiene Prisma 7.x con breaking
# changes y nuestro package.json espera 6.x. Copiar el node_modules de Demo
# (que sabemos que funciona) garantiza versiones identicas y es 10x mas rapido.
$yaInstalado = (Test-Path "$Carpeta\backend\node_modules\@prisma\client") -and
               (Test-Path "$Carpeta\backend\node_modules\.bin\prisma.cmd")
if ($SinInstalar) {
  Write-Host "[4/7] Salteando copia de node_modules (-SinInstalar)" -ForegroundColor DarkGray
} elseif ($Resume -and $yaInstalado) {
  Write-Host "[4/7] (skip) node_modules ya existe y tiene prisma" -ForegroundColor DarkGray
} else {
  Write-Host "[4/7] Copiando node_modules de Demo (~30 seg, mas confiable que npm install)..." -ForegroundColor Yellow
  if (Test-Path "$Carpeta\backend\node_modules") {
    Remove-Item -Recurse -Force "$Carpeta\backend\node_modules"
  }
  robocopy "$RepoOrigen\backend\node_modules" "$Carpeta\backend\node_modules" /E /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
  # Tambien copiar package-lock si existe (para futuras actualizaciones consistentes)
  if (Test-Path "$RepoOrigen\backend\package-lock.json") {
    Copy-Item "$RepoOrigen\backend\package-lock.json" "$Carpeta\backend\package-lock.json" -Force
  }
  if (Test-Path "$Carpeta\backend\node_modules\.bin\prisma.cmd") {
    Write-Host "      OK node_modules copiado (Prisma local detectado)" -ForegroundColor Green
  } else {
    Write-Host "      [AVISO] Copia hecha pero no encuentro prisma.cmd. Revisa manualmente." -ForegroundColor Yellow
  }
}

Write-Host "[5/7] Aplicando migraciones Prisma (usando binario local)..." -ForegroundColor Yellow
Push-Location "$Carpeta\backend"
# IMPORTANTE: usar el binario LOCAL (no npx que baja la ultima version de la registry)
$prismaBin = "$Carpeta\backend\node_modules\.bin\prisma.cmd"
if (Test-Path $prismaBin) {
  cmd /c "`"$prismaBin`" generate 2>&1" | Out-Null
  cmd /c "`"$prismaBin`" migrate deploy 2>&1"
  $rcMig = $LASTEXITCODE
  # db push: sincroniza el esquema real al del modelo Prisma. Cubre cualquier
  # columna que las migraciones no hayan creado (histórico de db push en dev),
  # asi la instalacion nueva queda 100% igual al schema y no falla el login/catalogos.
  Write-Host "      Sincronizando esquema (prisma db push)..." -ForegroundColor Gray
  cmd /c "`"$prismaBin`" db push --skip-generate --accept-data-loss 2>&1" | Out-Null
} else {
  Write-Host "      [ERROR] No encuentro $prismaBin - copiá node_modules de Demo primero" -ForegroundColor Red
  $rcMig = 1
}
Pop-Location
if ($rcMig -ne 0) {
  Write-Host "      [AVISO] prisma migrate deploy termino con exit $rcMig. Tal vez quedo algo a resolver con migrate resolve." -ForegroundColor Yellow
} else {
  Write-Host "      OK migraciones aplicadas" -ForegroundColor Green
}

# ---------- 5. Lanzador VBS adaptado ----------
Write-Host "[6/7] Creando lanzadores..." -ForegroundColor Yellow

# INICIAR-AGROCORE-Borghi.vbs
$vbsContent = @"
' ============================================================
'  INICIAR AGROCORE $Cliente (segundo plano, sin ventana)
'  Arranca el servidor SIN mostrar ninguna consola.
'  Para cerrarlo: CERRAR-AGROCORE.bat
' ============================================================
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "$Carpeta\backend"
sh.Run "cmd /c npm start", 0, False
"@
$vbsContent | Out-File -FilePath "$Carpeta\INICIAR-AGROCORE.vbs" -Encoding ascii

# CERRAR-AGROCORE-Borghi.bat
$cerrarContent = @"
@echo off
REM Cierra la instancia de AgroCore $Cliente (puerto $Puerto)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":$Puerto" ^| findstr "LISTENING"') do (
  echo Matando PID %%a
  taskkill /F /PID %%a
)
echo.
echo AgroCore $Cliente cerrado.
pause
"@
$cerrarContent | Out-File -FilePath "$Carpeta\CERRAR-AGROCORE.bat" -Encoding ascii

# _AgroCore-hidden.cmd adaptado (puerto y carpeta)
$hiddenContent = @"
@echo off
REM Helper interno - arranca el backend SIN ventana visible. Instancia $Cliente.
set "HERE=%~dp0"
if not exist "%HERE%logs" mkdir "%HERE%logs" 2>nul
set "PATH=%PATH%;%ProgramFiles%\nodejs;%ProgramFiles(x86)%\nodejs;%LOCALAPPDATA%\Programs\nodejs;%APPDATA%\npm"

REM Si ya hay algo en $Puerto, no pisarlo. Salir silencioso.
netstat -ano | findstr ":$Puerto" | findstr "LISTENING" >nul
if not errorlevel 1 exit /b 0

echo. >> "%HERE%logs\agrocore.log"
echo === AgroCore $Cliente arranque %DATE% %TIME% === >> "%HERE%logs\agrocore.log"

cd /d "%HERE%backend"
node src/server.js >> "%HERE%logs\agrocore.log" 2>&1
echo === Node termino con %errorlevel% %DATE% %TIME% === >> "%HERE%logs\agrocore.log"
"@
$hiddenContent | Out-File -FilePath "$Carpeta\_AgroCore-hidden.cmd" -Encoding ascii

# AgroCore-hidden.vbs (igual al original pero ahi)
$hiddenVbs = @"
' AgroCore $Cliente - lanzador totalmente oculto del backend.
Option Explicit
Dim shell, here, target
Set shell = CreateObject("WScript.Shell")
here = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\") - 1)
target = here & "\_AgroCore-hidden.cmd"
shell.Run """" & target & """", 0, False
"@
$hiddenVbs | Out-File -FilePath "$Carpeta\AgroCore-hidden.vbs" -Encoding ascii

Write-Host "      OK lanzadores creados" -ForegroundColor Green

# ---------- 6. Arrancar la instancia ----------
Write-Host "[7/7] Arrancando AgroCore $Cliente..." -ForegroundColor Yellow
Start-Process "wscript.exe" -ArgumentList "$Carpeta\INICIAR-AGROCORE.vbs"
Start-Sleep -Seconds 5
$enUsoAhora = netstat -ano | Select-String ":$Puerto" | Select-String "LISTENING"
if ($enUsoAhora) {
  Write-Host "      OK escuchando en puerto $Puerto" -ForegroundColor Green
} else {
  Write-Host "      [AVISO] No detecto el puerto $Puerto activo todavia. Revisar logs en $Carpeta\logs\agrocore.log" -ForegroundColor Yellow
}

# ---------- Resumen y pasos manuales ----------
Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  LISTO. Instancia $Cliente creada." -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Local: http://localhost:$Puerto/app" -ForegroundColor White
Write-Host ""
Write-Host "----- PASOS MANUALES FINALES -----" -ForegroundColor Yellow
Write-Host ""
Write-Host "USAMOS EL MISMO TUNEL DE DEMO (mas simple, recomendado por Cloudflare)" -ForegroundColor Cyan
Write-Host "No creamos un tunel nuevo. Solo le agregamos el hostname." -ForegroundColor Cyan
Write-Host ""
Write-Host "1) APUNTAR EL DNS DE $Subdominio AL TUNEL EXISTENTE:" -ForegroundColor Cyan
Write-Host "   cloudflared tunnel route dns agrocore-demo $Subdominio"
Write-Host ""
Write-Host "2) EDITAR C:\Users\sergi\.cloudflared\config.yml" -ForegroundColor Cyan
Write-Host "   Agregar BAJO 'ingress:' (ANTES del catch-all 404):"
Write-Host ""
Write-Host "    - hostname: $Subdominio"
Write-Host "      service: http://localhost:$Puerto"
Write-Host ""
Write-Host "3) REINICIAR EL TUNEL (Ctrl+C donde este corriendo y volver a arrancar):" -ForegroundColor Cyan
Write-Host "   cloudflared tunnel run agrocore-demo"
Write-Host ""
Write-Host "4) PROBAR EN EL NAVEGADOR:" -ForegroundColor Cyan
Write-Host "   https://$Subdominio/app"
Write-Host ""
Write-Host "----- USUARIO INICIAL -----" -ForegroundColor Yellow
Write-Host "   La base esta vacia. Entra como admin con las credenciales"
Write-Host "   por defecto (revisa el seed o crea uno desde /api/auth/registrar)"
Write-Host ""
