# ============================================================
#  SETUP COMPLETO - Cliente Borghi
# ------------------------------------------------------------
#  Este script hace TODO lo necesario para que Guillermo Borghi
#  pueda entrar a https://borghi.agrocore.ar/app
#
#  CORRELO COMO ADMIN: clic derecho > Ejecutar con PowerShell
# ============================================================

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  SETUP CLIENTE: Borghi" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Paso 1: correr el script generico
Write-Host "[PASO 1] Creando instancia local..." -ForegroundColor Yellow
& "$PSScriptRoot\Crear-Cliente.ps1" -Cliente "Borghi" -Puerto 3101
if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne $null) {
  Write-Host "[ERROR] Crear-Cliente fallo. Abortando." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "[PASO 2] Asignando borghi.agrocore.ar al tunel existente (agrocore-demo)..." -ForegroundColor Yellow
& cloudflared tunnel route dns agrocore-demo borghi.agrocore.ar

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  YA CASI! Falta UNA cosa manual:" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Abri con Bloc de notas:" -ForegroundColor Yellow
Write-Host "  C:\Users\sergi\.cloudflared\config.yml" -ForegroundColor White
Write-Host ""
Write-Host "Y AGREGA estas 2 lineas bajo 'ingress:' (ANTES del 404 final):" -ForegroundColor Yellow
Write-Host ""
Write-Host "  - hostname: borghi.agrocore.ar" -ForegroundColor White
Write-Host "    service: http://localhost:3101" -ForegroundColor White
Write-Host ""
Write-Host "Despues, REINICIA el tunel existente:" -ForegroundColor Yellow
Write-Host "  - Ctrl+C donde tengas corriendo cloudflared tunnel run agrocore-demo" -ForegroundColor White
Write-Host "  - Volve a arrancarlo: cloudflared tunnel run agrocore-demo" -ForegroundColor White
Write-Host ""
Write-Host "Y proba en el navegador (Ctrl+F5):" -ForegroundColor Yellow
Write-Host "  https://borghi.agrocore.ar/app" -ForegroundColor White
Write-Host ""
