# ============================================================
#  AgroCore - Publicar version 1.7.0 (Stock de hacienda unificado, nutrido por movimientos) + acumulados.
#  Correr en Demo: powershell -ExecutionPolicy Bypass -File C:\AgroCore\Subir-Version-1.7.0.ps1
# ============================================================
param([string]$InstallDir="C:\AgroCore",[string]$Version="1.7.0")
$ErrorActionPreference="Stop"; $tag="v$Version"; $repo="sergiobilbao29/agrocore"
function H1($m){ Write-Host "`n==== $m ====" -ForegroundColor Cyan }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Info($m){ Write-Host "[..] $m" -ForegroundColor Gray }
function Warn($m){ Write-Host "[!]  $m" -ForegroundColor Yellow }
Set-Location $InstallDir
if (-not (Test-Path ".git")) { throw "No es un repo git: $InstallDir" }
$archivos = @(
  "backend/src/server.js","AgroCore-web.html","backend/prisma/schema.prisma",
  "backend/prisma/migrations/20260630120000_v128_categorias_planilla/migration.sql",
  "backend/prisma/migrations/20260701120000_v129_cheques_campos/migration.sql",
  "backend/prisma/migrations/20260702120000_v140_hacienda_doble_stock/migration.sql",
  "backend/prisma/migrations/20260704120000_v150_venta_hacienda/migration.sql",
  "backend/prisma/migrations/20260705120000_v160_factura_hacienda/migration.sql",
  "backend/prisma/migrations/20260706120000_v170_producto_categoria_hacienda/migration.sql"
)
H1 "Estado del repo"; & git status --short
$resp = Read-Host "Continuar con commit + push + tag + release de $tag? [s/N]"
if ($resp -notmatch '^[sSyY]') { Info "Cancelado."; exit 0 }
H1 "Commit"; & git add -- $archivos
if (& git diff --cached --name-only) { & git commit -m "v$Version`: Stock de hacienda unificado en modulo Stock (nutrido por movimientos) + mapeo producto-categoria"; Ok "Commit creado." } else { Warn "Sin cambios staged." }
H1 "Push"; $old=$ErrorActionPreference; $ErrorActionPreference='Continue'
& git push origin main 2>&1 | ForEach-Object { Write-Host "    $_" }
if ($LASTEXITCODE -ne 0) { $ErrorActionPreference=$old; throw "git push fallo" }
if (-not (& git tag --list $tag)) { & git tag -a $tag -m "AgroCore $tag" }
& git push origin $tag 2>&1 | ForEach-Object { Write-Host "    $_" }
$ErrorActionPreference=$old; Ok "Tag publicado."
H1 "Release"
$token=$null
try { $resp2=@("protocol=https","host=github.com","") | & git credential fill 2>$null
  $pw=$resp2 | Where-Object { $_ -like 'password=*' } | Select-Object -First 1
  if ($pw) { $token=($pw -replace '^password=','') } } catch {}
if (-not $token) { $sec=Read-Host "GitHub PAT (scope repo)" -AsSecureString
  $token=[Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)) }
$notas="- Stock de hacienda unificado: el modulo Stock muestra cabezas + kg reales de los productos de hacienda, nutridos por los movimientos de hacienda.`n- En cada producto categoria 'hacienda' se elige a que categoria de hacienda corresponde (campo nuevo); asi calza el stock.`n- Productos de hacienda sin vincular muestran aviso; la fila linkea al modulo Hacienda.`n- (Acumulado) Hacienda Fase 1-4, cheques/tesoreria, creditos/calendario, fixes de alineacion y modal de factura.`n- INCLUYE MIGRACION DE BASE."
$body=@{ tag_name=$tag; name="AgroCore $tag"; body=$notas; draft=$false; prerelease=$false } | ConvertTo-Json
$headers=@{ Authorization="token $token"; Accept="application/vnd.github+json"; "User-Agent"="AgroCore-Release" }
try { $r=Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases" -Method Post -Headers $headers -Body $body -ContentType "application/json"; Ok "Release: $($r.html_url)" }
catch { $c=$_.Exception.Response.StatusCode.value__; if ($c -eq 422){ Warn "La release $tag ya existia." } else { Warn "No se pudo crear la release (HTTP $c). Crear a mano en github.com/$repo/releases/new" } }
H1 "Listo"; Ok "v$Version publicada. En cada cliente: Verificar actualizaciones -> Instalar."
