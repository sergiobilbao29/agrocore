# ============================================================
#  AgroCore - Forzar actualizacion (recuperacion)
#  Para cuando "Verificar actualizaciones -> Instalar" se queda colgado
#  (tipicamente porque 'git pull' falla por cambios locales o divergencia).
#  Hace backup, fuerza el codigo a la version publicada (git reset --hard),
#  reinstala, migra y reinicia SOLO esta instancia.
#
#  Correr en la instancia afectada, ej. Peiretti:
#    powershell -ExecutionPolicy Bypass -File C:\AgroCore\Forzar-Actualizacion.ps1 -Servicio AgroCore-Backend -Puerto 3100
#  Borghi:
#    powershell -ExecutionPolicy Bypass -File C:\AgroCore\Forzar-Actualizacion.ps1 -Servicio AgroCore-Borghi -Puerto 3101
#  Demo (sin servicio):
#    powershell -ExecutionPolicy Bypass -File C:\AgroCore\Forzar-Actualizacion.ps1 -Puerto 3100
# ============================================================
param(
  [string]$InstallDir = "C:\AgroCore",
  [int]$Puerto = 3100,
  [string]$Servicio = ""
)
$ErrorActionPreference = "Stop"; $ProgressPreference = "SilentlyContinue"
function H1($m){ Write-Host "`n==== $m ====" -ForegroundColor Cyan }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Info($m){ Write-Host "[..] $m" -ForegroundColor Gray }
function Warn($m){ Write-Host "[!]  $m" -ForegroundColor Yellow }
function Err($m){ Write-Host "[ER] $m" -ForegroundColor Red }

if (-not (Test-Path $InstallDir)) { Err "No existe $InstallDir"; exit 1 }
$backendDir = Join-Path $InstallDir "backend"
$svcName = if ($Servicio) { $Servicio } else { 'AgroCore-Backend' }

H1 "Backup de la base (por las dudas)"
try {
  $backupDir = Join-Path $InstallDir "backups"; if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Path $backupDir | Out-Null }
  $pgDump = $null; foreach ($v in @("18","17","16","15","14")) { $c="C:\Program Files\PostgreSQL\$v\bin\pg_dump.exe"; if (Test-Path $c){$pgDump=$c;break} }
  $envFile = Join-Path $backendDir ".env"
  if ($pgDump -and (Test-Path $envFile)) {
    $dbUrl=(Select-String -Path $envFile -Pattern "^DATABASE_URL=" | ForEach-Object { $_.Line -replace '^DATABASE_URL=','' })
    if ($dbUrl){ $dbUrl=$dbUrl.Trim().Trim('"').Trim("'").Split('?')[0]; $f=Join-Path $backupDir ("pre-forzar-"+(Get-Date -Format yyyyMMdd-HHmmss)+".sql")
      $ErrorActionPreference='Continue'; & $pgDump --no-owner --no-acl --encoding=UTF8 -f $f $dbUrl 2>&1 | Out-Null; $ErrorActionPreference='Stop'
      if (Test-Path $f){ Ok "Backup: $f" } else { Warn "No se pudo generar backup, sigo igual." } }
  } else { Warn "pg_dump o .env no encontrados, sigo sin backup." }
} catch { Warn "Backup fallo: $($_.Exception.Message). Sigo igual." }

H1 "Deteniendo esta instancia ($svcName / :$Puerto)"
$svc = Get-Service -Name $svcName -ErrorAction SilentlyContinue
if ($svc) { try { Stop-Service -Name $svcName -Force -ErrorAction Stop; Ok "Servicio detenido." } catch { Warn $_.Exception.Message }; Start-Sleep 3 }
$conns = Get-NetTCPConnection -LocalPort $Puerto -State Listen -ErrorAction SilentlyContinue
if ($conns) { $conns.OwningProcess | Select-Object -Unique | ForEach-Object { try { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } catch {} }; Start-Sleep 2 }

H1 "Forzando codigo a la version publicada"
Push-Location $InstallDir
try {
  if (-not (Test-Path ".git")) { Err "No es repo git: $InstallDir (usa el instalador ZIP)"; Pop-Location; exit 2 }
  $ErrorActionPreference='Continue'
  & git fetch origin 2>&1 | ForEach-Object { Write-Host "    $_" }
  if ($LASTEXITCODE -ne 0) { Err "git fetch fallo"; Pop-Location; exit 2 }
  $branch="main"; & git show-ref --verify --quiet refs/remotes/origin/main; if ($LASTEXITCODE -ne 0){ $branch="master" }
  & git reset --hard "origin/$branch" 2>&1 | ForEach-Object { Write-Host "    $_" }
  if ($LASTEXITCODE -ne 0) { Err "git reset --hard fallo"; Pop-Location; exit 2 }
  & git submodule update --init --recursive 2>&1 | ForEach-Object { Write-Host "    $_" }
  $ErrorActionPreference='Stop'
  Ok "Codigo en origin/$branch."
} finally { Pop-Location }

H1 "Dependencias + migraciones"
Push-Location $backendDir
try {
  $ErrorActionPreference='Continue'
  Info "npm install..."; & npm install --omit=dev --no-audit --no-fund --loglevel=error 2>&1 | ForEach-Object { Write-Host "    $_" }
  Info "prisma migrate deploy..."; & npx prisma migrate deploy 2>&1 | ForEach-Object { Write-Host "    $_" }
  Info "prisma db push..."; & npx prisma db push --accept-data-loss --skip-generate 2>&1 | ForEach-Object { Write-Host "    $_" }
  Info "prisma generate..."; & npx prisma generate 2>&1 | ForEach-Object { Write-Host "    $_" }
  $ErrorActionPreference='Stop'
} finally { Pop-Location }

H1 "Reiniciando"
if ($svc) { try { Start-Service -Name $svcName; Start-Sleep 3; Ok "Servicio arrancado." } catch { Err $_.Exception.Message } }
else { $vbs=Join-Path $InstallDir "INICIAR-AGROCORE.vbs"; if (Test-Path $vbs){ Start-Process "wscript.exe" -ArgumentList "`"$vbs`"" -WindowStyle Hidden; Start-Sleep 3; Ok "Arrancado via VBS." } else { Warn "Arranca AgroCore manualmente." } }

H1 "Verificando"
$ok=$false
for ($i=0; $i -lt 60; $i++){ try { $r=Invoke-RestMethod -Uri "http://localhost:$Puerto/api/system/version" -TimeoutSec 2 -ErrorAction Stop; $ok=$true; Ok "Responde version $($r.version)"; break } catch { Start-Sleep 1 } }
if (-not $ok) { Err "No respondio en 60s. Revisa $InstallDir\logs\backend-err.log" } else { Ok "Listo. Recarga el navegador con Ctrl+Shift+R." }
