# ============================================================
#  AgroCore - Publicar version 1.2.9 en GitHub (todo en uno)
#  Commit -> push main -> tag v1.2.9 -> Release (por API, sin 'gh').
#  v1.2.9 es solo codigo (sin migracion de base).
#  Correr en la maquina FUENTE (Demo):
#     powershell -ExecutionPolicy Bypass -File C:\AgroCore\Subir-Version-1.2.9.ps1
# ============================================================
param(
  [string]$InstallDir = "C:\AgroCore",
  [string]$Version    = "1.2.9"
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
  "backend/prisma/migrations/20260701120000_v129_cheques_campos/migration.sql"
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
  $msg = "v$Version`: medios externos + estados/datos/filtros de cheque + aviso 7 dias despues + editar cuentas bancarias"
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
  '- Movimientos diarios: metodo de pago "Billetera / medio externo" (no toca cuentas bancarias; queda como caja en Efectivo). Medios configurables en Catalogos.',
  '- Bancos: editar y eliminar/desactivar cuentas bancarias.',
  '- Cheques: estados configurables (boton Estados) + estado Endosado/Entregado.',
  '- Cheques: nuevos campos (fecha recepcion, CUIT titular, endosante, en poder de) y filtros por banco/cuenta/numero/tipo.',
  '- Calendario: aviso 7 dias DESPUES del vencimiento del cheque (revisar si se pago o rechazo).',
  '- INCLUYE MIGRACION DE BASE: el actualizador corre migrate deploy + db push + generate.'
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
