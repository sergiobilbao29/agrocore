# ============================================================
# AgroCore - actualizador automatico
# Pulla la ultima version del repo, aplica migraciones de DB y reinicia el server.
# Uso:
#   - Doble clic al acceso directo "Actualizar AgroCore" en el menu Inicio
#   - O ejecutar manualmente: powershell -ExecutionPolicy Bypass -File Update-AgroCore.ps1
# Backup automatico ANTES de tocar nada. Si algo falla, el .sql queda en C:\AgroCore\backups.
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

H1 "AgroCore - Actualizador automatico"

# 1. Verificar que existe la instalacion
if (-not (Test-Path $InstallDir)) { Err "No se encuentra AgroCore en $InstallDir"; pause; exit 1 }
$backendDir = Join-Path $InstallDir "backend"
if (-not (Test-Path $backendDir)) { Err "No se encuentra el backend en $backendDir"; pause; exit 1 }
Ok "Instalacion encontrada: $InstallDir"

# 2. Leer AGROCORE_REPO del .env (con fallback al default)
$envFileForRepo = Join-Path $backendDir ".env"
$repoSlug = "agrocore-ar/agrocore"
if (Test-Path $envFileForRepo) {
  $repoLine = Select-String -Path $envFileForRepo -Pattern '^AGROCORE_REPO=' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($repoLine) {
    $val = $repoLine.Line -replace '^AGROCORE_REPO=',''
    $val = $val.Trim().Trim('"').Trim("'")
    if ($val) { $repoSlug = $val }
  }
}
Info "Repositorio de actualizaciones: $repoSlug"

# 3. Verificar version actual vs ultima disponible
H1 "Verificando version disponible..."
$currentVersion = "desconocida"
$latestVersion  = "desconocida"
try {
  $r = Invoke-RestMethod -Uri "http://localhost:3100/api/system/version" -TimeoutSec 5
  $currentVersion = $r.version
  Info "Version instalada: $currentVersion"
} catch {
  Warn "No se pudo consultar el sistema corriendo. Esta apagado? Continuamos igual."
}
try {
  $headers = @{ 'Accept' = 'application/vnd.github+json'; 'User-Agent' = 'AgroCore-Updater' }
  $r = Invoke-RestMethod -Uri "https://api.github.com/repos/$repoSlug/releases/latest" -Headers $headers -TimeoutSec 10
  $latestVersion = $r.tag_name -replace '^v',''
  Info "Ultima version publicada: $latestVersion"
} catch {
  Warn "No se pudo consultar GitHub ($repoSlug). Continuamos con git pull."
}

if ($currentVersion -ne "desconocida" -and $latestVersion -ne "desconocida" -and $currentVersion -eq $latestVersion) {
  Ok "Ya estas en la ultima version ($currentVersion). Nada que hacer."
  Read-Host "Presiona Enter para salir"
  exit 0
}

# Si no se pudo determinar la ultima version (sin releases publicadas o sin internet),
# preguntar antes de seguir.
if ($latestVersion -eq "desconocida") {
  Warn "No se pudo determinar la ultima version remota."
  Warn "Esto pasa si el repositorio no tiene releases publicadas todavia, o si no hay internet."
  $resp = Read-Host "Queres forzar el update igual (git pull + npm install + migrate)? [s/N]"
  if ($resp -notmatch '^[sSyY]') {
    Info "Cancelado por el usuario. Sin cambios."
    exit 0
  }
}

# 4. Backup automatico antes de actualizar
if (-not $SkipBackup) {
  H1 "Backup automatico antes de actualizar..."
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
      # Sacar parametros tipo ?schema=public que pg_dump no acepta
      $dbUrl = $dbUrl.Trim().Trim('"').Trim("'")
      $dbUrl = $dbUrl.Split('?')[0]
      Info "Generando backup: $backupFile"
      & $pgDump --no-owner --no-acl --encoding=UTF8 -f $backupFile $dbUrl
      if ($LASTEXITCODE -eq 0) { Ok "Backup generado." } else { Warn "Backup fallo (codigo $LASTEXITCODE). Continuamos con cuidado." }
    } else { Warn "No se pudo leer DATABASE_URL del .env. Sin backup automatico." }
  } else { Warn "pg_dump no encontrado. Sin backup automatico." }
}

# 5. Detener AgroCore
H1 "Deteniendo AgroCore..."
$nodeProcs = Get-Process -Name "node" -ErrorAction SilentlyContinue
if ($nodeProcs) {
  $nodeProcs | Stop-Process -Force
  Start-Sleep -Seconds 2
  Ok "AgroCore detenido."
} else {
  Info "AgroCore no estaba corriendo."
}

# 6. Pull de la ultima version
H1 "Descargando ultima version..."
Push-Location $InstallDir
try {
  if (Test-Path ".git") {
    Info "git pull..."
    & git pull --ff-only 2>&1 | ForEach-Object { Write-Host "    $_" }
    if ($LASTEXITCODE -ne 0) { Err "git pull fallo"; exit 2 }
    Info "Actualizando submodulos (web/img, manual, etc)..."
    & git submodule update --init --recursive 2>&1 | ForEach-Object { Write-Host "    $_" }
    Ok "Codigo actualizado."
  } else {
    Warn "No es un repositorio git. Descargando ZIP de la ultima release..."
    $zipUrl = "https://github.com/$repoSlug/archive/refs/tags/v$latestVersion.zip"
    $zipPath = "$env:TEMP\agrocore-update.zip"
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
    Info "Extrayendo..."
    Expand-Archive -Path $zipPath -DestinationPath "$env:TEMP\agrocore-extract" -Force
    # Copiar archivos sin pisar .env ni node_modules
    $extractRoot = Get-ChildItem "$env:TEMP\agrocore-extract" -Directory | Select-Object -First 1
    Copy-Item -Path "$($extractRoot.FullName)\*" -Destination $InstallDir -Recurse -Force -Exclude @("node_modules",".env")
    Remove-Item $zipPath, "$env:TEMP\agrocore-extract" -Recurse -Force
    Ok "Codigo extraido."
  }
} finally { Pop-Location }

# 7. Reinstalar deps + migraciones
H1 "Actualizando dependencias..."
Push-Location $backendDir
try {
  Info "npm install (puede tardar 1-3 minutos)..."
  & npm install --omit=dev --no-audit --no-fund --loglevel=error
  if ($LASTEXITCODE -ne 0) { Err "npm install fallo"; exit 3 }
  Ok "Dependencias actualizadas."

  Info "Aplicando migraciones de base..."
  & npx prisma migrate deploy
  if ($LASTEXITCODE -ne 0) { Err "prisma migrate deploy fallo"; exit 4 }
  Ok "Migraciones aplicadas."

  Info "Regenerando Prisma Client..."
  & npx prisma generate
  Ok "Prisma Client OK."
} finally { Pop-Location }

# 8. Reiniciar AgroCore
H1 "Reiniciando AgroCore..."
$vbs = Join-Path $InstallDir "INICIAR-AGROCORE.vbs"
if (Test-Path $vbs) {
  Start-Process "wscript.exe" -ArgumentList "`"$vbs`"" -WindowStyle Hidden
  Start-Sleep -Seconds 3
  Ok "AgroCore reiniciado."
} else {
  Warn "No se encontro INICIAR-AGROCORE.vbs. Inicia AgroCore manualmente."
}

# 9. Verificar que vuelve a responder
Info "Verificando que el sistema responde (hasta 60 segundos)..."
$timeout = 60
$started = $false
for ($i = 0; $i -lt $timeout; $i++) {
  try {
    $r = Invoke-RestMethod -Uri "http://localhost:3100/api/system/version" -TimeoutSec 2 -ErrorAction Stop
    $started = $true
    Ok "Sistema respondiendo en version $($r.version)"
    break
  } catch {
    Start-Sleep -Seconds 1
  }
}
if (-not $started) {
  Err "El sistema no respondio en $timeout segundos. Revisar logs en backend\logs."
  Read-Host "Presiona Enter"
  exit 5
}

H1 "[OK] Actualizacion completada"
Ok "AgroCore actualizado a la ultima version."
Info "Abri el navegador en http://localhost:3100 para verlo."
Read-Host "Presiona Enter para salir"
