# ============================================================
# Instala AgroCore Backend como Windows Service usando NSSM.
# Resultado: el server corre OCULTO en background, arranca solo
# en cada boot, se reinicia automaticamente si crashea, y logea
# a C:\AgroCore\logs\backend.log
#
# Correr UNA SOLA VEZ como Administrador.
# Idempotente: si el servicio ya existe lo reconfigura y reinicia.
# ============================================================

$ErrorActionPreference = 'Stop'

$AgroCoreRoot = 'C:\AgroCore'
$BackendDir   = Join-Path $AgroCoreRoot 'backend'
$ToolsDir     = Join-Path $AgroCoreRoot 'tools'
$LogsDir      = Join-Path $AgroCoreRoot 'logs'
$NssmExe      = Join-Path $ToolsDir 'nssm.exe'
$ServiceName  = 'AgroCore-Backend'

function Info($m) { Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "[OK]   $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Err($m)  { Write-Host "[ERR]  $m" -ForegroundColor Red }

# ----- 0) Comprobar privilegios -----
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Err 'Este script tiene que correr como Administrador. Click derecho -> Ejecutar como administrador.'
  exit 1
}

# ----- 1) Verificar carpetas -----
if (-not (Test-Path $BackendDir)) { Err "No existe $BackendDir"; exit 1 }
if (-not (Test-Path $ToolsDir))   { New-Item -ItemType Directory -Path $ToolsDir -Force | Out-Null }
if (-not (Test-Path $LogsDir))    { New-Item -ItemType Directory -Path $LogsDir   -Force | Out-Null }

# ----- 2) Encontrar node.exe -----
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) { Err 'No se encontro node.exe en el PATH. Instalar Node 20 LTS antes de correr esto.'; exit 1 }
$nodeExe = $nodeCmd.Source
Info "node.exe -> $nodeExe"

# ----- 3) Descargar NSSM si no esta -----
if (-not (Test-Path $NssmExe)) {
  Info 'Descargando NSSM (Non-Sucking Service Manager)...'
  $zipUrl  = 'https://nssm.cc/release/nssm-2.24.zip'
  $zipPath = Join-Path $env:TEMP 'nssm.zip'
  $unzipTo = Join-Path $env:TEMP 'nssm-unzip'
  if (Test-Path $unzipTo) { Remove-Item -Recurse -Force $unzipTo }
  try {
    Invoke-WebRequest -UseBasicParsing -Uri $zipUrl -OutFile $zipPath
    Expand-Archive -Path $zipPath -DestinationPath $unzipTo -Force
    # NSSM trae carpetas win32 y win64. Usamos la de 64 bits si la hay.
    $arch = if ([Environment]::Is64BitOperatingSystem) { 'win64' } else { 'win32' }
    $found = Get-ChildItem -Path $unzipTo -Recurse -Filter nssm.exe | Where-Object { $_.FullName -match "\\$arch\\" } | Select-Object -First 1
    if (-not $found) { $found = Get-ChildItem -Path $unzipTo -Recurse -Filter nssm.exe | Select-Object -First 1 }
    Copy-Item $found.FullName $NssmExe -Force
    Remove-Item -Recurse -Force $unzipTo, $zipPath -ErrorAction SilentlyContinue
    Ok "NSSM instalado en $NssmExe"
  } catch {
    Err "No pude bajar NSSM: $($_.Exception.Message)"
    Err "Bajalo a mano de https://nssm.cc/release/nssm-2.24.zip, copiá nssm.exe (64 bits) a $NssmExe y volvé a correr este script."
    exit 1
  }
} else {
  Ok "NSSM ya esta en $NssmExe"
}

# ----- 4) Si hay procesos node.exe sueltos (foreground), matarlos -----
$nodeProcs = Get-Process node -ErrorAction SilentlyContinue
if ($nodeProcs) {
  Warn "Hay $($nodeProcs.Count) proceso(s) node.exe vivos. Los voy a matar antes de instalar el servicio."
  $nodeProcs | Stop-Process -Force
  Start-Sleep -Seconds 2
}

# ----- 5) Si el servicio ya existe, pararlo y removerlo para reconfigurar limpio -----
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc) {
  Info "El servicio $ServiceName ya existe. Lo paro y reconfiguro."
  & $NssmExe stop $ServiceName confirm 2>$null | Out-Null
  Start-Sleep -Seconds 2
  & $NssmExe remove $ServiceName confirm 2>$null | Out-Null
  Start-Sleep -Seconds 1
}

# ----- 6) Crear el servicio -----
Info "Creando servicio $ServiceName..."
& $NssmExe install $ServiceName $nodeExe 'src\server.js'
& $NssmExe set $ServiceName AppDirectory   $BackendDir
& $NssmExe set $ServiceName AppStdout      (Join-Path $LogsDir 'backend.log')
& $NssmExe set $ServiceName AppStderr      (Join-Path $LogsDir 'backend-err.log')
& $NssmExe set $ServiceName AppRotateFiles 1
& $NssmExe set $ServiceName AppRotateOnline 1
& $NssmExe set $ServiceName AppRotateSeconds 86400      # rotar cada 24hs
& $NssmExe set $ServiceName AppRotateBytes 10485760     # o cuando supere 10 MB
& $NssmExe set $ServiceName Start SERVICE_AUTO_START
& $NssmExe set $ServiceName DisplayName 'AgroCore Backend'
& $NssmExe set $ServiceName Description 'API Node de AgroCore (escucha en puerto 3100). Corre como Windows Service oculto.'
& $NssmExe set $ServiceName AppEnvironmentExtra "NODE_ENV=production"
& $NssmExe set $ServiceName AppNoConsole 1
# Politica de reinicio si crashea
& $NssmExe set $ServiceName AppExit Default Restart
& $NssmExe set $ServiceName AppRestartDelay 5000
& $NssmExe set $ServiceName AppThrottle 10000

# ----- 7) Arrancar el servicio -----
Info 'Arrancando servicio...'
& $NssmExe start $ServiceName | Out-Null
Start-Sleep -Seconds 5

# ----- 8) Verificar -----
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) { Err "El servicio no se creo bien."; exit 1 }
if ($svc.Status -ne 'Running') {
  Err "El servicio quedo en estado $($svc.Status). Revisá los logs:"
  Err "  $LogsDir\backend-err.log"
  exit 1
}
Ok "Servicio $ServiceName en estado $($svc.Status)."

# Probar /api/health
try {
  Start-Sleep -Seconds 2
  $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3100/api/health' -TimeoutSec 10
  Ok "Health OK: $($r.Content)"
  $rv = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3100/api/system/version' -TimeoutSec 10
  Ok "Version: $($rv.Content)"
} catch {
  Warn "El servicio arranco pero /api/health no respondio aun. Revisá $LogsDir\backend.log"
  Warn "Error: $($_.Exception.Message)"
}

Write-Host ''
Ok '====================================================='
Ok 'AgroCore Backend instalado como servicio de Windows.'
Ok '====================================================='
Write-Host ''
Write-Host 'Comandos utiles:' -ForegroundColor White
Write-Host "  Get-Service $ServiceName" -ForegroundColor Gray
Write-Host "  Restart-Service $ServiceName" -ForegroundColor Gray
Write-Host "  Stop-Service $ServiceName" -ForegroundColor Gray
Write-Host "  Get-Content $LogsDir\backend.log -Tail 50 -Wait" -ForegroundColor Gray
Write-Host ''
Write-Host 'El servicio arranca solo en cada reboot, corre oculto y se reinicia automaticamente si crashea.' -ForegroundColor White
