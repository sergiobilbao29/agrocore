# ============================================================
#  AgroCore - Crear la Release en GitHub desde PowerShell
#  Usa la API de GitHub. Reutiliza el token que ya tenes guardado
#  en el Administrador de credenciales (el mismo con el que pushea git),
#  asi no hace falta instalar 'gh' ni pegar ningun token a mano.
#  Uso:
#     powershell -ExecutionPolicy Bypass -File C:\AgroCore\Crear-Release.ps1
#     (opcional) ... -Version 1.2.5
# ============================================================
param(
  [string]$Version    = "1.2.5",
  [string]$InstallDir = "C:\AgroCore",
  [string]$Notes      = ""
)
$ErrorActionPreference = "Stop"
$tag = "v$Version"
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Info($m){ Write-Host "[..] $m" -ForegroundColor Gray }
function Warn($m){ Write-Host "[!]  $m" -ForegroundColor Yellow }
function Err($m){ Write-Host "[ER] $m" -ForegroundColor Red }

# 1. Repo (de AGROCORE_REPO en el .env, con fallback)
$repo = "sergiobilbao29/agrocore"
$envFile = Join-Path $InstallDir "backend\.env"
if (Test-Path $envFile) {
  $line = Select-String -Path $envFile -Pattern '^AGROCORE_REPO=' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($line) { $v = ($line.Line -replace '^AGROCORE_REPO=','').Trim().Trim('"').Trim("'"); if ($v) { $repo = $v } }
}
Info "Repositorio: $repo"
Info "Release a crear: $tag"

# 2. Notas (si no se pasaron, uso las de la v1.2.5)
if (-not $Notes) {
  $Notes = @(
    '- Hacienda: los selectores de categoria ahora muestran TODAS las categorias del catalogo y de TODAS las especies (bovino, porcino, etc.), no solo la lista bovina fija.',
    '- Cartas de porte: boton "Borrar todas" en Viajes (doble confirmacion) + endpoint DELETE /api/viajes acotado a la empresa.',
    '- Compartir ubicacion por WhatsApp: ahora funciona desde el celular (abre la app nativa via wa.me) en vez de pedir WhatsApp Web.'
  ) -join "`n"
}

# 3. Obtener el token guardado de git (credential manager) para github.com
Info "Obteniendo credencial guardada de git para github.com..."
$token = $null
try {
  $resp = @("protocol=https","host=github.com","") | & git credential fill 2>$null
  $pwLine = $resp | Where-Object { $_ -like 'password=*' } | Select-Object -First 1
  if ($pwLine) { $token = ($pwLine -replace '^password=','') }
} catch { }

# 3b. Si no hay credencial guardada, pedir un token a mano (seguro, no se muestra)
if (-not $token) {
  Warn "No se encontro un token guardado para github.com."
  Warn "Pega un GitHub Personal Access Token (con permiso 'repo'). No se va a mostrar en pantalla."
  $sec = Read-Host "Token" -AsSecureString
  $token = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
            [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}
if (-not $token) { Err "Sin token no se puede crear la release."; exit 1 }

# 4. POST a la API de Releases
$body = @{
  tag_name = $tag
  name     = "AgroCore $tag"
  body     = $Notes
  draft    = $false
  prerelease = $false
} | ConvertTo-Json

$headers = @{
  Authorization = "token $token"
  Accept        = "application/vnd.github+json"
  "User-Agent"  = "AgroCore-Release"
}
$url = "https://api.github.com/repos/$repo/releases"

try {
  $r = Invoke-RestMethod -Uri $url -Method Post -Headers $headers -Body $body -ContentType "application/json"
  Ok "Release publicada: $($r.html_url)"
} catch {
  $code = $_.Exception.Response.StatusCode.value__
  if ($code -eq 422) {
    Warn "La release de $tag ya existia (o el tag no esta pusheado). Revisa:"
    Warn "   https://github.com/$repo/releases"
  } elseif ($code -eq 401 -or $code -eq 403) {
    Err "Token sin permisos o invalido (HTTP $code). Necesita scope 'repo'."
  } else {
    Err "Fallo al crear la release (HTTP $code): $($_.Exception.Message)"
  }
  exit 2
}

Write-Host ""
Ok "Listo. Ahora en cada cliente el boton 'Verificar actualizaciones' va a detectar $tag."
