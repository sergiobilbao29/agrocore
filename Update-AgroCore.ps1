# ============================================================
# AgroCore — actualizador automático
# Pulla la última versión del repo, aplica migraciones de DB y reinicia el server.
# Uso:
#   - Doble clic al acceso directo "Actualizar AgroCore" en el menú Inicio
#   - O ejecutar manualmente: powershell -ExecutionPolicy Bypass -File Update-AgroCore.ps1
# Backup automático ANTES de tocar nada — si algo falla, el .sql queda en C:\AgroCore\backups.
# ============================================================
param(
  [string]$InstallDir = "C:\AgroCore",
  [switch]$SkipBackup = $false
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function H1($msg) { Write-Host "`n========================================" -ForegroundColor Cyan; Write-Host " $msg" -ForegroundColor Cyan; Write-Host "========================================" -ForegroundColor Cyan }
function Ok($msg) { Write-Host "[OK] $msg" -ForegroundColor Green }
function Info($msg) { Write-Host "[..] $msg" -ForegroundColor Gray }
function Warn($msg) { Write-Host "[!]  $msg" -ForegroundColor Yellow }
function Err($msg) { Write-Host "[ER] $msg" -ForegroundColor Red }

H1 "AgroCore — Actualizador automático"

# 1. Verificar que existe la instalación
if (-not (Test-Path $InstallDir)) { Err "No se encuentra AgroCore en $InstallDir"; pause; exit 1 }
$backendDir = Join-Path $InstallDir "backend"
if (-not (Test-Path $backendDir)) { Err "No se encuentra el backend en $backendDir"; pause; exit 1 }
Ok "Instalación encontrada: $InstallDir"

# 2. Verificar versión actual vs última disponible
H1 "Verificando versión disponible..."
$currentVersion = "desconocida"
$latestVersion  = "desconocida"
try {
  $r = Invoke-RestMethod -Uri "http://localhost:3100/api/system/version" -TimeoutSec 5
  $currentVersion = $r.version
  Info "Versión instalada: $currentVersion"
} catch {
  Warn "No se pudo consultar el sistema corriendo. ¿Está apagado? Continuamos igual."
}
try {
  $headers = @{ 'Accept' = 'application/vnd.github+json'; 'User-Agent' = 'AgroCore-Updater' }
  $r = Invoke-RestMethod -Uri "https://api.github.com/repos/agrocore-ar/agrocore/releases/latest" -Headers $headers -TimeoutSec 10
  $latestVersion = $r.tag_name -replace '^v',''
  Info "Última versión publicada: $latestVersion"
} catch {
  Warn "No se pudo consultar GitHub. Continuamos con git pull."
}

if ($currentVersion -ne "desconocida" -and $latestVersion -ne "desconocida" -and $currentVersion -eq $latestVersion) {
  Ok "Ya estás en la última versión ($currentVersion). Nada que hacer."
  Read-Host "Presioná Enter para salir"
  exit 0
}

# 3. Backup automático antes de actualizar
if (-not $SkipBackup) {
  H1 "Backup automático antes de actualizar..."
  $backupDir = Join-Path $InstallDir "backups"
  if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Path $backupDir | Out-Null }
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backupFile = Join-Path $backupDir "pre-update-$stamp.sql"
  # Buscar pg_dump
  $pgDump = $null
  foreach ($v in @("18","17","16","15","14")) {
    $cand = "C:\Program Files\PostgreSQL\$v\bin\pg_dump.exe"
    if (Test-Path $cand) { $pgDump = $cand; break }
  }
  if ($pgDump) {
    $envFile = Join-Path $backendDir ".env"
    $dbUrl = (Select-String -Path $envFile -Pattern "^DATABASE_URL=" | ForEach-Object { $_.Line -replace '^DATABASE_URL=','' })
    if ($dbUrl) {
      Info "Generando backup: $backupFile"
      & $pgDump --no-owner --no-acl --encoding=UTF8 -f $backupFile $dbUrl
      if ($LASTEXITCODE -eq 0) { Ok "Backup generado." } else { Warn "Backup falló (código $LASTEXITCODE) — continuamos con cuidado." }
    } else { Warn "No se pudo leer DATABASE_URL del .env — sin backup automático." }
  } else { Warn "pg_dump no encontrado — sin backup automático." }
}

# 4. Detener AgroCore
H1 "Deteniendo AgroCore..."
$nodeProcs = Get-Process -Name "node" -ErrorAction SilentlyContinue
if ($nodeProcs) {
  $nodeProcs | Stop-Process -Force
  Start-Sleep -Seconds 2
  Ok "AgroCore detenido."
} else {
  Info "AgroCore no estaba corriendo."
}

# 5. Pull de la última versión
H1 "Descargando última versión..."
Push-Location $InstallDir
try {
  if (Test-Path ".git") {
    Info "git pull..."
    & git pull --ff-only 2>&1 | ForEach-Object { Write-Host "    $_" }
    if ($LASTEXITCODE -ne 0) { Err "git pull falló"; exit 2 }
    Ok "Código actualizado."
  } else {
    Warn "No es un repositorio git. Descargando ZIP de la última release..."
    $repo = "agrocore-ar/agrocore"
    $zipUrl = "https://github.com/$repo/archive/refs/tags/v$latestVersion.zip"
    $zipPath = "$env:TEMP\agrocore-update.zip"
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
    Info "Extrayendo..."
    Expand-Archive -Path $zipPath -DestinationPath "$env:TEMP\agrocore-extract" -Force
    # Copiar archivos sin pisar .env ni node_modules
    $extractRoot = Get-ChildItem "$env:TEMP\agrocore-extract" -Directory | Select-Object -First 1
    Copy-Item -Path "$($extractRoot.FullName)\*" -Destination $InstallDir -Recurse -Force -Exclude @("node_modules",".env")
    Remove-Item $zipPath, "$env:TEMP\agrocore-extract" -Recurse -Force
    Ok "Código extraído."
  }
} finally { Pop-Location }

# 6. Reinstalar deps + migraciones
H1 "Actualizando dependencias..."
Push-Location $backendDir
try {
  Info "npm install (puede tardar 1-3 minutos)..."
  & npm install --omit=dev --no-audit --no-fund --loglevel=error
  if ($LASTEXITCODE -ne 0) { Err "npm install falló"; exit 3 }
  Ok "Dependencias actualizadas."

  Info "Aplicando migraciones de base..."
  & npx prisma migrate deploy
  if ($LASTEXITCODE -ne 0) { Err "prisma migrate deploy falló"; exit 4 }
  Ok "Migraciones aplicadas."

  Info "Regenerando Prisma Client..."
  & npx prisma generate
  Ok "Prisma Client OK."
} finally { Pop-Location }

# 7. Reiniciar AgroCore
H1 "Reiniciando AgroCore..."
$vbs = Join-Path $InstallDir "INICIAR-AGROCORE.vbs"
if (Test-Path $vbs) {
  Start-Process "wscript.exe" -ArgumentList "`"$vbs`"" -WindowStyle Hidden
  Start-Sleep -Seconds 3
  Ok "AgroCore reiniciado."
} else {
  Warn "No se encontró INICIAR-AGROCORE.vbs — iniciá AgroCore manualmente."
}

# 8. Verificar que vuelve a responder
Info "Verificando que el sistema responde..."
$timeout = 30
$started = $false
for ($i = 0; $i -lt $timeout; $i++) {
  try {
    $r = Invoke-RestMethod -Uri "http://localhost:3100/api/system/version" -TimeoutSec 2 -ErrorAction Stop
    $started = $true
    Ok "Sistema respondiendo en versión $($r.version)"
    break
  } catch {
    Start-Sleep -Seconds 1
  }
}
if (-not $started) {
  Err "El sistema no respondió en $timeout segundos. Revisar logs en backend\logs."
  Read-Host "Presioná Enter"
  exit 5
}

H1 "✅ Actualización completada"
Ok "AgroCore actualizado a la última versión."
Info "Abrí el navegador en http://localhost:3100 para verlo."
Read-Host "Presioná Enter para salir"
