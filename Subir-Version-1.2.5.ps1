# ============================================================
#  AgroCore - Publicar version 1.2.5 en GitHub
#  Corre en la maquina FUENTE (Demo, C:\AgroCore).
#  Hace: commit de los archivos de la release -> push a main ->
#        tag v1.2.5 -> crea la Release en GitHub (para que el boton
#        "Verificar actualizaciones" la detecte en cada cliente).
#  Uso (PowerShell):
#     powershell -ExecutionPolicy Bypass -File C:\AgroCore\Subir-Version-1.2.5.ps1
# ============================================================
param(
  [string]$InstallDir = "C:\AgroCore",
  [string]$Version    = "1.2.5"
)
$ErrorActionPreference = "Stop"
$tag = "v$Version"

function H1($m){ Write-Host "`n==== $m ====" -ForegroundColor Cyan }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Info($m){ Write-Host "[..] $m" -ForegroundColor Gray }
function Warn($m){ Write-Host "[!]  $m" -ForegroundColor Yellow }

Set-Location $InstallDir

# 0. Chequeo basico: estamos en el repo y en main
if (-not (Test-Path ".git")) { throw "No es un repo git: $InstallDir" }
$branch = (& git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne "main") { Warn "Rama actual: $branch (se esperaba main). Continuando igual." }

# 1. Mostrar lo que hay sin commitear, para que decidas
H1 "Estado del repo"
& git status --short

Write-Host ""
Warn "Este script SOLO sube a la release los 2 archivos de la v${Version}:"
Warn "   - backend\src\server.js   (version + endpoint DELETE /api/viajes)"
Warn "   - AgroCore-web.html       (Hacienda categorias, borrar cartas, WhatsApp, changelog)"
Warn "Si hay OTROS archivos modificados arriba (migraciones, package-lock, etc.) NO se incluyen."
Warn "OJO: no edites a mano migraciones ya aplicadas: Prisma las marca por checksum y falla en los clientes."
$resp = Read-Host "Continuar con commit + push + release de $tag? [s/N]"
if ($resp -notmatch '^[sSyY]') { Info "Cancelado. Sin cambios remotos."; exit 0 }

# 2. Stage SOLO los archivos de la release
H1 "Commit"
& git add -- "backend/src/server.js" "AgroCore-web.html"
$staged = (& git diff --cached --name-only)
if (-not $staged) { Warn "No hay cambios staged en esos 2 archivos. Nada que commitear."; }
else {
  $msg = "v$Version`: Hacienda multi-especie + borrar cartas de porte en masa + WhatsApp ubicacion desde el celular"
  & git commit -m $msg
  Ok "Commit creado."
}

# 3. Push de main
H1 "Push a origin/main"
$old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
& git push origin main 2>&1 | ForEach-Object { Write-Host "    $_" }
if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = $old; throw "git push fallo (exit $LASTEXITCODE)" }
$ErrorActionPreference = $old
Ok "main actualizado en GitHub."

# 4. Tag de la version
H1 "Tag $tag"
$existe = (& git tag --list $tag)
if ($existe) { Warn "El tag $tag ya existe localmente. Lo reuso." }
else { & git tag -a $tag -m "AgroCore $tag"; Ok "Tag $tag creado." }
$ErrorActionPreference = 'Continue'
& git push origin $tag 2>&1 | ForEach-Object { Write-Host "    $_" }
$ErrorActionPreference = $old
Ok "Tag publicado."

# 5. Crear la Release en GitHub (necesaria para "Verificar actualizaciones")
H1 "Release de GitHub"
$notas = @"
v$Version

- Hacienda: los selectores de categoria ahora muestran TODAS las categorias del catalogo y de TODAS las especies (bovino, porcino, etc.), no solo la lista bovina fija.
- Cartas de porte: boton "Borrar todas" en Viajes (doble confirmacion) + endpoint DELETE /api/viajes acotado a la empresa.
- Compartir ubicacion por WhatsApp: ahora funciona desde el celular (abre la app nativa via wa.me) en vez de pedir WhatsApp Web.
"@
$gh = Get-Command gh -ErrorAction SilentlyContinue
if ($gh) {
  $ErrorActionPreference = 'Continue'
  & gh release create $tag --title "AgroCore $tag" --notes $notas 2>&1 | ForEach-Object { Write-Host "    $_" }
  if ($LASTEXITCODE -eq 0) { Ok "Release $tag publicada en GitHub." }
  else { Warn "gh release fallo. Crea la release a mano (ver abajo)." ; $gh = $null }
  $ErrorActionPreference = $old
}
if (-not $gh) {
  Warn "No se encontro 'gh' (GitHub CLI), o fallo. Crea la Release manualmente:"
  Write-Host "    1) Entra a https://github.com/sergiobilbao29/agrocore/releases/new" -ForegroundColor Yellow
  Write-Host "    2) Tag: $tag   (ya esta pusheado)" -ForegroundColor Yellow
  Write-Host "    3) Titulo: AgroCore $tag" -ForegroundColor Yellow
  Write-Host "    4) Pega las notas de arriba y dale Publish release." -ForegroundColor Yellow
}

H1 "Listo"
Ok "v$Version subida. Ahora en cada cliente: boton 'Verificar actualizaciones' -> Instalar, o corre Update-AgroCore.ps1."
