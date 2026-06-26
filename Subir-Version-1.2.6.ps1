# ============================================================
#  AgroCore - Publicar version 1.2.6 en GitHub (todo en uno)
#  Commit (3 archivos) -> push main -> tag v1.2.6 -> Release.
#  La Release se crea por la API de GitHub usando el token ya
#  guardado en el Administrador de credenciales (no necesita 'gh').
#  Correr en la maquina FUENTE (Demo):
#     powershell -ExecutionPolicy Bypass -File C:\AgroCore\Subir-Version-1.2.6.ps1
# ============================================================
param(
  [string]$InstallDir = "C:\AgroCore",
  [string]$Version    = "1.2.6"
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

# Archivos que entran en esta release (v1.2.6)
$archivos = @("backend/src/server.js", "AgroCore-web.html", "Update-AgroCore.ps1")

H1 "Estado del repo"
& git status --short
Write-Host ""
Warn "Se van a subir SOLO estos archivos de la v${Version}:"
$archivos | ForEach-Object { Warn "   - $_" }
$resp = Read-Host "Continuar con commit + push + tag + release de $tag? [s/N]"
if ($resp -notmatch '^[sSyY]') { Info "Cancelado."; exit 0 }

# 1. Commit
H1 "Commit"
& git add -- $archivos
$staged = (& git diff --cached --name-only)
if ($staged) {
  $msg = "v$Version`: updates desde el sistema conscientes de cada instancia (InstallDir/puerto/servicio + kill por puerto)"
  & git commit -m $msg
  Ok "Commit creado."
} else { Warn "No habia cambios staged. Quizas ya estaba commiteado." }

# 2. Push main
H1 "Push a origin/main"
$old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
& git push origin main 2>&1 | ForEach-Object { Write-Host "    $_" }
if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = $old; throw "git push fallo (exit $LASTEXITCODE)" }

# 3. Tag
H1 "Tag $tag"
if (-not (& git tag --list $tag)) { & git tag -a $tag -m "AgroCore $tag" }
& git push origin $tag 2>&1 | ForEach-Object { Write-Host "    $_" }
$ErrorActionPreference = $old
Ok "Tag publicado."

# 4. Release por API (token guardado de git para github.com)
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
  '- Las actualizaciones "desde el sistema" ahora son conscientes de cada instancia: cada una se actualiza a si misma (su carpeta, puerto y servicio) y detiene SOLO su propio node, sin tumbar las otras instancias de la misma maquina.',
  '- Configurar AGROCORE_SERVICE en el .env de cada instancia (Demo: vacio; Peiretti: AgroCore-Backend; Borghi: AgroCore-Borghi).'
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
Ok "v$Version publicada."
Info "Demo:     reinicia su backend para cargar v$Version."
Info "Peiretti: Verificar actualizaciones -> Instalar  (agrega AGROCORE_SERVICE=AgroCore-Backend en su .env primero)."
Info "Borghi:   primera vez todavia por Actualizar-Borghi.ps1; de ahi en mas ya puede usar el boton del sistema."
