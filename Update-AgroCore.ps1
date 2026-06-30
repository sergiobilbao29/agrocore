# ============================================================
# AgroCore - actualizador automatico
# Pulla la ultima version del repo, aplica migraciones de DB y reinicia el server.
# Uso:
#   - Doble clic al acceso directo "Actualizar AgroCore" en el menu Inicio
#   - O ejecutar manualmente: powershell -ExecutionPolicy Bypass -File Update-AgroCore.ps1
# Backup automatico ANTES de tocar nada. Si algo falla, el .sql queda en C:\AgroCore\backups.
# ============================================================
param(
  # Si no se pasa, usa la carpeta donde esta ESTE script (asi cada copia actualiza
  # su propia instalacion: C:\AgroCore, C:\AgroCore-Borghi, etc.)
  [string]$InstallDir = "",
  [switch]$SkipBackup = $false,
  # Modo desatendido (lo lanza el sistema mismo desde el boton "Instalar
  # actualizacion ahora" en la web). NO espera Enter al terminar.
  [switch]$Unattended = $false,
  # Puerto de ESTA instancia (Demo/Peiretti 3100, Borghi 3101). Si no se pasa, se
  # lee del .env de la instalacion. Se usa para matar SOLO el node de esta instancia.
  [int]$Puerto = 0,
  # Nombre del servicio Windows de ESTA instancia (vacio = autodetectar por la carpeta).
  # Demo: (vacio). Peiretti: AgroCore-Backend. Borghi: AgroCore-Borghi.
  [string]$Servicio = ""
)
# --- Resolucion automatica de instancia (para que la copia de cada install se actualice a si misma) ---
if (-not $InstallDir) { $InstallDir = if ($PSScriptRoot) { $PSScriptRoot } else { "C:\AgroCore" } }
if (-not $Puerto -or $Puerto -eq 0) {
  $envFile = Join-Path $InstallDir "backend\.env"
  if (Test-Path $envFile) {
    $m = Select-String -Path $envFile -Pattern '^\s*PORT\s*=\s*(\d+)' | Select-Object -First 1
    if ($m) { $Puerto = [int]$m.Matches[0].Groups[1].Value }
  }
  if (-not $Puerto -or $Puerto -eq 0) { $Puerto = 3100 }
}
if (-not $Servicio) {
  try {
    $svc = Get-CimInstance Win32_Service -ErrorAction SilentlyContinue |
           Where-Object { $_.PathName -like "*$InstallDir*" } | Select-Object -First 1
    if ($svc) { $Servicio = $svc.Name }
  } catch {}
}
Write-Host "[..] Instancia: $InstallDir  (puerto $Puerto, servicio $(if($Servicio){$Servicio}else{'-'}))" -ForegroundColor Gray
# Nombre de servicio efectivo: si no vino por parametro ni autodeteccion, probamos el legacy.
$svcName = if ($Servicio) { $Servicio } else { 'AgroCore-Backend' }

function Pause-IfInteractive($prompt) {
  if (-not $Unattended) { Read-Host $prompt | Out-Null }
}

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
  $r = Invoke-RestMethod -Uri "http://localhost:$Puerto/api/system/version" -TimeoutSec 5
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
  Pause-IfInteractive "Presiona Enter para salir"
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
      $oldErrPref2 = $ErrorActionPreference
      $ErrorActionPreference = 'Continue'
      try {
        & $pgDump --no-owner --no-acl --encoding=UTF8 -f $backupFile $dbUrl 2>&1 | ForEach-Object { Write-Host "    $_" }
        if ($LASTEXITCODE -eq 0) { Ok "Backup generado." } else { Warn "Backup fallo (codigo $LASTEXITCODE). Continuamos con cuidado." }
      } finally { $ErrorActionPreference = $oldErrPref2 }
    } else { Warn "No se pudo leer DATABASE_URL del .env. Sin backup automatico." }
  } else { Warn "pg_dump no encontrado. Sin backup automatico." }
}

# 5. Detener AgroCore (SOLO esta instancia)
H1 "Deteniendo AgroCore ($svcName / puerto $Puerto)..."
$svc = Get-Service -Name $svcName -ErrorAction SilentlyContinue
$svcInstalado = [bool]$svc
if ($svcInstalado) {
  Info "Deteniendo servicio $svcName..."
  try { Stop-Service -Name $svcName -Force -ErrorAction Stop; Ok "Servicio detenido." }
  catch { Warn "Stop-Service fallo: $($_.Exception.Message)." }
  Start-Sleep -Seconds 3
} else {
  Info "No hay servicio '$svcName' (esta instancia se arranca por VBS/npm)."
}
# Matar SOLO el node que escucha en este puerto. NO tocamos los node de otras
# instancias en la misma maquina (antes se mataban TODOS y se caia Demo+Borghi).
$conns = Get-NetTCPConnection -LocalPort $Puerto -State Listen -ErrorAction SilentlyContinue
if ($conns) {
  $conns.OwningProcess | Select-Object -Unique | ForEach-Object {
    try { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue; Ok "Node en :$Puerto detenido (PID $_)." } catch {}
  }
  Start-Sleep -Seconds 2
} else {
  Info "Nada escuchando en :$Puerto (ya estaba detenido)."
}

# 6. Pull de la ultima version
H1 "Descargando ultima version..."
Push-Location $InstallDir
try {
  if (Test-Path ".git") {
    Info "git pull..."
    # Git escribe info por stderr ("From github.com/..."). Con ErrorActionPreference=Stop
    # PowerShell lo interpreta como excepcion y mata el script. Por eso aca cambiamos
    # temporalmente a Continue mientras corre git, y verificamos el exit code manualmente.
    $oldErrPref = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      $gitOut = & git pull --ff-only 2>&1
      $gitOut | ForEach-Object { Write-Host "    $_" }
      if ($LASTEXITCODE -ne 0) {
        # Caso tipico en instancias cliente: hay cambios locales o el branch divergio,
        # entonces 'pull --ff-only' falla y antes el update quedaba colgado. Como las
        # instancias cliente NO deben tener cambios propios, forzamos la version publicada:
        # fetch + reset --hard al remoto. (El backup de la base ya se hizo en el paso 4.)
        Warn "git pull --ff-only fallo (exit $LASTEXITCODE). Forzando a la version publicada (reset --hard)..."
        & git fetch origin 2>&1 | ForEach-Object { Write-Host "    $_" }
        if ($LASTEXITCODE -ne 0) { Err "git fetch fallo (exit $LASTEXITCODE)"; exit 2 }
        # Branch remoto por defecto: main (con fallback a master).
        $branch = "main"
        & git show-ref --verify --quiet refs/remotes/origin/main
        if ($LASTEXITCODE -ne 0) { $branch = "master" }
        & git reset --hard "origin/$branch" 2>&1 | ForEach-Object { Write-Host "    $_" }
        if ($LASTEXITCODE -ne 0) { Err "git reset --hard fallo (exit $LASTEXITCODE)"; exit 2 }
        Ok "Codigo forzado a origin/$branch."
      }
      Info "Actualizando submodulos (web/img, manual, etc)..."
      $subOut = & git submodule update --init --recursive 2>&1
      $subOut | ForEach-Object { Write-Host "    $_" }
      # No abortamos por error de submodulo, solo avisamos
      if ($LASTEXITCODE -ne 0) { Warn "git submodule update salio con codigo $LASTEXITCODE (continuamos igual)" }
    } finally {
      $ErrorActionPreference = $oldErrPref
    }
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
  # Mismo issue que con git: npm y prisma escriben info por stderr y con
  # ErrorActionPreference=Stop el script muere. Cambiamos a Continue mientras
  # corren estos comandos y verificamos LASTEXITCODE a mano.
  $oldErrPref = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    Info "npm install (puede tardar 1-3 minutos)..."
    & npm install --omit=dev --no-audit --no-fund --loglevel=error 2>&1 | ForEach-Object { Write-Host "    $_" }
    if ($LASTEXITCODE -ne 0) { Err "npm install fallo (exit $LASTEXITCODE)"; exit 3 }
    Ok "Dependencias actualizadas."

    Info "Aplicando migraciones de base..."
    & npx prisma migrate deploy 2>&1 | ForEach-Object { Write-Host "    $_" }
    if ($LASTEXITCODE -ne 0) { Err "prisma migrate deploy fallo (exit $LASTEXITCODE)"; exit 4 }
    Ok "Migraciones aplicadas."

    # Sincronizar cualquier cambio de schema que no este en una migracion formal.
    # Algunos campos agregados por db push en dev tambien necesitan correr aca.
    # Es idempotente: si no hay cambios, no hace nada.
    Info "Sincronizando schema de la base (db push)..."
    & npx prisma db push --accept-data-loss --skip-generate 2>&1 | ForEach-Object { Write-Host "    $_" }
    if ($LASTEXITCODE -ne 0) { Warn "db push fallo (codigo $LASTEXITCODE), continuamos igual." } else { Ok "Schema sincronizado." }

    Info "Regenerando Prisma Client..."
    & npx prisma generate 2>&1 | ForEach-Object { Write-Host "    $_" }
    if ($LASTEXITCODE -ne 0) { Warn "prisma generate fallo (codigo $LASTEXITCODE)" } else { Ok "Prisma Client OK." }
  } finally {
    $ErrorActionPreference = $oldErrPref
  }
} finally { Pop-Location }

# 8. Reiniciar AgroCore
H1 "Reiniciando AgroCore..."
if ($svcInstalado) {
  Info "Arrancando servicio $svcName..."
  try {
    Start-Service -Name $svcName -ErrorAction Stop
    Start-Sleep -Seconds 3
    Ok "Servicio arrancado."
  } catch {
    Err "No se pudo arrancar el servicio: $($_.Exception.Message)"
    Err "Revisa los logs en $InstallDir\logs\backend-err.log"
  }
} else {
  $vbs = Join-Path $InstallDir "INICIAR-AGROCORE.vbs"
  if (Test-Path $vbs) {
    Start-Process "wscript.exe" -ArgumentList "`"$vbs`"" -WindowStyle Hidden
    Start-Sleep -Seconds 3
    Ok "AgroCore reiniciado (modo legacy via VBS)."
    Warn "Recomendado: instalar como servicio corriendo Instalar-Servicio-AgroCore.ps1 una sola vez."
  } else {
    Warn "No hay servicio instalado ni VBS launcher. Inicia AgroCore manualmente."
  }
}

# 9. Verificar que vuelve a responder
Info "Verificando que el sistema responde (hasta 60 segundos)..."
$timeout = 60
$started = $false
for ($i = 0; $i -lt $timeout; $i++) {
  try {
    $r = Invoke-RestMethod -Uri "http://localhost:$Puerto/api/system/version" -TimeoutSec 2 -ErrorAction Stop
    $started = $true
    Ok "Sistema respondiendo en version $($r.version)"
    break
  } catch {
    Start-Sleep -Seconds 1
  }
}
if (-not $started) {
  Err "El sistema no respondio en $timeout segundos. Revisar logs en backend\logs."
  Pause-IfInteractive "Presiona Enter"
  exit 5
}

H1 "[OK] Actualizacion completada"
Ok "AgroCore actualizado a la ultima version."
Info "Abri el navegador en http://localhost:$Puerto para verlo."
Pause-IfInteractive "Presiona Enter para salir"
