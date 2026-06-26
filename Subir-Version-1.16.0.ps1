# ============================================================
#  AgroCore - Publicar version 1.16.0 (Importar factura de compra desde PDF en dolares mejorada) + acumulados.
#  Correr en Demo: powershell -ExecutionPolicy Bypass -File C:\AgroCore\Subir-Version-1.16.0.ps1
#  NOTA: no agrega migracion nueva.
# ============================================================
param([string]$InstallDir="C:\AgroCore",[string]$Version="1.16.0")
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
  "backend/prisma/migrations/20260706120000_v170_producto_categoria_hacienda/migration.sql",
  "backend/prisma/migrations/20260707120000_v190_multimoneda/migration.sql",
  "backend/prisma/migrations/20260708120000_v1130_campo_deposito/migration.sql",
  "backend/prisma/migrations/20260709120000_v1140_cheque_fechaendoso/migration.sql"
)
H1 "Estado del repo"; & git status --short
$resp = Read-Host "Continuar con commit + push + tag + release de $tag? [s/N]"
if ($resp -notmatch '^[sSyY]') { Info "Cancelado."; exit 0 }
H1 "Commit"; & git add -- $archivos
if (& git diff --cached --name-only) { & git commit -m "v$Version`: parser PDF factura compra - punto venta/numero compacto, tipo con comillas, moneda USD + cotizacion (TC), total U`$S, CUIT emisor"; Ok "Commit creado." } else { Warn "Sin cambios staged." }
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
$notas="- Importacion de factura de compra desde PDF (sin QR legible) mejorada: punto de venta + numero (0002-00006490), tipo con comillas, fecha, total.`n- Facturas en dolares: detecta U`$S y la cotizacion 'TC: 1.461,50' y completa moneda + cotizacion en el formulario.`n- CUIT del emisor: ahora reconoce 'C.U.I.T.' con puntos.`n- Sin migracion nueva."
$body=@{ tag_name=$tag; name="AgroCore $tag"; body=$notas; draft=$false; prerelease=$false } | ConvertTo-Json
$headers=@{ Authorization="token $token"; Accept="application/vnd.github+json"; "User-Agent"="AgroCore-Release" }
try { $r=Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases" -Method Post -Headers $headers -Body $body -ContentType "application/json"; Ok "Release: $($r.html_url)" }
catch { $c=$_.Exception.Response.StatusCode.value__; if ($c -eq 422){ Warn "La release $tag ya existia." } else { Warn "No se pudo crear la release (HTTP $c)." } }
H1 "Listo"; Ok "v$Version publicada. En cada cliente: Verificar actualizaciones -> Instalar."
