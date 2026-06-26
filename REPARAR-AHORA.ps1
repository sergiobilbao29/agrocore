# ============================================================
#  AgroCore - Reparacion de emergencia (v2, autodetecta servicios)
#  Levanta Demo (3100) y Borghi (3101) sin depender del nombre exacto
#  del servicio. Si el servicio no levanta el puerto, arranca node directo.
#  Correr en PowerShell COMO ADMINISTRADOR.
# ============================================================
$ErrorActionPreference = "Continue"
function H1($m){ Write-Host "`n==== $m ====" -ForegroundColor Cyan }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Info($m){ Write-Host "[..] $m" -ForegroundColor Gray }
function Warn($m){ Write-Host "[!]  $m" -ForegroundColor Yellow }

# Resolver node.exe
$nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodeExe) {
  foreach ($c in @("$env:ProgramFiles\nodejs\node.exe","${env:ProgramFiles(x86)}\nodejs\node.exe","$env:LOCALAPPDATA\Programs\nodejs\node.exe")) {
    if (Test-Path $c) { $nodeExe = $c; break }
  }
}
if ($nodeExe) { Info "node: $nodeExe" } else { Warn "No se encontro node.exe en el PATH." }

# 1. Cerrar updates colgados (sin tocar los node de los servidores que escuchan)
H1 "Cerrando actualizaciones colgadas"
$colgados = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*Update-AgroCore*' }
if ($colgados) { $colgados | ForEach-Object { Info "Matando PID $($_.ProcessId)"; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Ok "Updates cerrados." }
else { Info "No habia updates colgados." }
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*npm*install*' -or $_.CommandLine -like '*node-gyp*' } |
  ForEach-Object { Info "Matando npm/node-gyp PID $($_.ProcessId)"; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# 2. Autodetectar y arrancar TODOS los servicios *AgroCore*
H1 "Servicios *AgroCore* instalados"
$svcs = Get-Service -Name "*AgroCore*" -ErrorAction SilentlyContinue
if ($svcs) {
  foreach ($s in $svcs) {
    Info "$($s.Name)  ->  $($s.Status)"
    if ($s.Status -ne 'Running') {
      try { Start-Service $s.Name -ErrorAction Stop; Ok "Arrancado: $($s.Name)" }
      catch { Warn "No arranco $($s.Name): $($_.Exception.Message)" }
    }
  }
} else { Warn "No hay servicios *AgroCore* (Demo quizas corre por npm/VBS)." }
Start-Sleep -Seconds 4

# 3. Asegurar cada instancia por puerto; si no escucha, arrancar node directo
function Ensure($nombre, $port, $backend) {
  $up = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if ($up) { Ok "$nombre ya escucha en :$port"; return }
  if (-not (Test-Path $backend)) { Warn "${nombre}: no existe $backend"; return }
  if (-not $nodeExe) { Warn "${nombre}: sin node.exe no puedo arrancarlo a mano."; return }
  Warn "$nombre no escucha en :$port -> arrancando node directo..."
  $logDir = Join-Path (Split-Path $backend -Parent) "logs"
  if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
  Start-Process -FilePath $nodeExe -ArgumentList "src\server.js" -WorkingDirectory $backend -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDir "manual-out.log") `
    -RedirectStandardError  (Join-Path $logDir "manual-err.log")
  Start-Sleep -Seconds 5
}
H1 "Asegurando puertos"
Ensure "Demo"   3100 "C:\AgroCore\backend"
Ensure "Borghi" 3101 "C:\AgroCore-Borghi\backend"

# 4. Verificar HTTP y, si falla, mostrar el final del log
H1 "Verificacion final"
function Check($nombre, $port, $base) {
  for ($i=0; $i -lt 25; $i++) {
    try { $r = Invoke-RestMethod -Uri "http://localhost:$port/api/system/version" -TimeoutSec 2 -ErrorAction Stop
          Ok "$nombre OK -> v$($r.version) (:$port)"; return }
    catch { Start-Sleep -Seconds 1 }
  }
  Warn "$nombre NO responde en :$port. Ultimas lineas del log:"
  foreach ($lf in @("logs\manual-err.log","backend\logs\backend-err.log","logs\agrocore.log")) {
    $p = Join-Path $base $lf
    if (Test-Path $p) { Write-Host "---- $p ----" -ForegroundColor DarkGray; Get-Content $p -Tail 20 | ForEach-Object { Write-Host "    $_" } }
  }
}
Check "Demo"   3100 "C:\AgroCore"
Check "Borghi" 3101 "C:\AgroCore-Borghi"

H1 "Listo"
Warn "En Borghi NO uses 'Verificar actualizaciones' del sistema (apunta a Demo)."
Warn "Para actualizar Borghi: C:\AgroCore-Borghi\Actualizar-Borghi.ps1"
