# ============================================================
#  AgroCore - Publicar version 1.2.8 en GitHub (todo en uno)
#  Commit -> push main -> tag v1.2.8 -> Release (por API, sin 'gh').
#  v1.2.8 incluye cambio de SCHEMA + migracion (categorias de planilla).
#  Correr en la maquina FUENTE (Demo):
#     powershell -ExecutionPolicy Bypass -File C:\AgroCore\Subir-Version-1.2.8.ps1
# ============================================================
param(
  [string]$InstallDir = "C:\AgroCore",
  [string]$Version    = "1.2.8"
)
$ErrorActionPreference = "Stop"
$tag  = "v$Version"
$repo = "sergiobilbao29/agrocore"
function H1($m){ Write-Host "`n==== $m ====" -ForegroundColor Cyan }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Info($m){ Write-Host "[..] $m" -ForegroundColor Gray }
function Warn($m){ Write-Host "[!]  $m" -ForegroundColor Yellow }

Set-Location $InstallDir
if (-not (Test-Path ".git")) { throw "No es un repo git: $InstallDir" }

$archivos = @(
  "backend/src/server.js",
  "AgroCore-web.html",
  "backend/prisma/schema.prisma",
  "backend/prisma/migrations/20260630120000_v128_categorias_planilla/migration.sql"
)

H1 "Estado del repo"
& git status --short
Write-Host ""
Warn "Se van a subir estos archivos de la v${Version}:"
$archivos | ForEach-Object { Warn "   - $_" }
$resp = Read-Host "Continuar con commit + push + tag + release de $tag? [s/N]"
if ($resp -notmatch '^[sSyY]') { Info "Cancelado."; exit 0 }

H1 "Commit"
& git add -- $archivos
$staged = (& git diff --cached --name-only)
if ($staged) {
  $msg = "v$Version`: planilla con categorias configurables + Dias trabajados + acceso visible"
  & git commit -m $msg
  Ok "Commit creado."
} else { Warn "No habia cambios staged." }

H1 "Push a origin/main"
$old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
& git push origin main 2>&1 | ForEach-Object { Write-Host "    $_" }
if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = $old; throw "git push fallo (exit $LASTEXITCODE)" }

H1 "Tag $tag"
if (-not (& git tag --list $tag)) { & git tag -a $tag -m "AgroCore $tag" }
& git push origin $tag 2>&1 | ForEach-Object { Write-Host "    $_" }
$ErrorActionPreference = $old
Ok "Tag publicado."

H1 "Creando la Release en GitHub"
$token = $null
try {
  $resp2 = @("protocol=https","host=github.com","") | & git credential fill 2>$null
  $pwLine = $resp2 | Where-Object { $_ -like 'password=*' } | Select-Object -First 1
  if ($pwLine) { $token = ($pwLine -replace '^password=','') }
} catch { }
if (-not $token) {
  Warn "No se encontro token guardado. Pega un GitHub PAT (scope 'repo'); no se muestra."
  $sec = Read-Host "Token" -AsSecureString
  $token = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}
$notas = @(
  '- Planilla de empleados: nueva categoria "Dias trabajados" (dias x importe por dia).',
  '- Categorias de planilla configurables (boton Categorias): agregar/eliminar, de monto fijo o cantidad x valor con unidad.',
  '- Acceso mas visible: boton "Ver planilla" en cada empleado y dentro de la edicion.',
  '- Incluye migracion de base (categorias + campos cantidad/valor): el actualizador corre migrate deploy + db push + generate.'
) -join "`n"
$body = @{ tag_name=$tag; name="AgroCore $tag"; body=$notas; draft=$false; prerelease=$false } | ConvertTo-Json
$headers = @{ Authorization="token $token"; Accept="application/vnd.github+json"; "User-Agent"="AgroCore-Release" }
try {
  $r = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases" -Method Post -Headers $headers -Body $body -ContentType "application/json"
  Ok "Release publicada: $($r.html_url)"
} catch {
  $code = $_.Exception.Response.StatusCode.value__
  if ($code -eq 422) { Warn "La release $tag ya existia. Revisa: https://github.com/$repo/releases" }
  else { Warn "No se pudo crear la release (HTTP $code). Crea a mano: https://github.com/$repo/releases/new (tag $tag)." }
}

H1 "Listo"
Ok "v$Version publicada. En cada instancia: Verificar actualizaciones -> Instalar."
