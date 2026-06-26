# ============================================================
#  AgroCore - Migrar una instancia a otro servidor
# ------------------------------------------------------------
#  Cuando un cliente decide comprar el sistema y quiere
#  hostearlo en su propia PC (o en AWS), este script:
#
#   1. Hace pg_dump de la base actual
#   2. Empaqueta el .env + la carpeta backend (sin node_modules)
#   3. Te genera un README con los comandos exactos para
#      restaurar en el servidor destino.
#
#  USO:
#    .\Migrar-Cliente-A-Servidor.ps1 -Cliente "Borghi"
# ============================================================

param(
  [Parameter(Mandatory=$true)]
  [string]$Cliente,

  [string]$PasswordDB = "agrocore_dev_2026",
  [string]$Salida = "$env:USERPROFILE\Desktop"
)

$ErrorActionPreference = "Stop"

$ClienteLower = $Cliente.ToLower()
$Carpeta      = "C:\AgroCore-$Cliente"
$DBName       = "agrocore_$ClienteLower"
$timestamp    = Get-Date -Format "yyyyMMdd-HHmmss"
$paqueteDir   = "$Salida\AgroCore-$Cliente-Migracion-$timestamp"

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Migrando instancia $Cliente" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Carpeta origen : $Carpeta"
Write-Host "  Base de datos  : $DBName"
Write-Host "  Paquete sale a : $paqueteDir"
Write-Host ""

if (-not (Test-Path $Carpeta)) {
  Write-Host "[ERROR] No existe la carpeta $Carpeta" -ForegroundColor Red
  exit 1
}

New-Item -ItemType Directory -Force -Path $paqueteDir | Out-Null

# ---------- 1. pg_dump de la base ----------
Write-Host "[1/3] Generando dump de PostgreSQL..." -ForegroundColor Yellow
$env:PGPASSWORD = $PasswordDB
$dumpFile = "$paqueteDir\$DBName-$timestamp.sql"
& "pg_dump" -U agrocore -h localhost -F p -f $dumpFile $DBName
if (-not (Test-Path $dumpFile)) {
  Write-Host "[ERROR] No se genero el dump" -ForegroundColor Red
  exit 1
}
$tamMB = [math]::Round((Get-Item $dumpFile).Length / 1MB, 2)
Write-Host "      OK $tamMB MB" -ForegroundColor Green

# ---------- 2. Copiar codigo + .env ----------
Write-Host "[2/3] Empaquetando codigo + config..." -ForegroundColor Yellow
$codigoDir = "$paqueteDir\codigo"
robocopy $Carpeta $codigoDir /E /XD node_modules .git logs uploads /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
Write-Host "      OK codigo copiado" -ForegroundColor Green

# ---------- 3. Generar README de instalacion ----------
Write-Host "[3/3] Generando README..." -ForegroundColor Yellow
$readme = @"
============================================================
 AgroCore - Migracion de $Cliente
 Fecha: $timestamp
============================================================

ESTE PAQUETE CONTIENE:

  /codigo                    -> backend + frontend (sin node_modules)
  $DBName-$timestamp.sql -> dump completo de la base

============================================================
 PARA RESTAURAR EN EL SERVIDOR DESTINO (Windows o Linux):
============================================================

REQUISITOS PREVIOS EN EL SERVIDOR:
  - Node.js 20+
  - PostgreSQL 14+
  - Git (opcional, para futuras actualizaciones)

PASOS:

1) COPIAR LA CARPETA AL SERVIDOR DESTINO
   Sube todo este paquete via SCP/USB/RDP. Quedara por ejemplo
   en C:\AgroCore (Windows) o /opt/agrocore (Linux).

2) CREAR LA BASE DE DATOS EN EL SERVIDOR DESTINO
   psql -U postgres
     CREATE USER agrocore WITH PASSWORD 'AGREGAR_PASSWORD_FUERTE_AQUI';
     CREATE DATABASE $DBName OWNER agrocore;
     \q

3) RESTAURAR EL DUMP
   psql -U agrocore -d $DBName -f $DBName-$timestamp.sql

4) ACTUALIZAR EL .env DEL CODIGO
   Editar codigo/backend/.env:
   - Cambiar el password en DATABASE_URL al que pusiste arriba
   - Cambiar JWT_SECRET por uno NUEVO (correr: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
   - Verificar PORT (puede dejarse el mismo si no hay conflicto)

5) INSTALAR DEPENDENCIAS Y APLICAR MIGRACIONES PENDIENTES
   cd codigo/backend
   npm install
   npx prisma generate
   npx prisma migrate deploy

6) ARRANCAR
   Windows: doble click en INICIAR-AGROCORE.vbs (en la carpeta del codigo)
   Linux:   pm2 start src/server.js --name agrocore-$ClienteLower

7) (OPCIONAL) APUNTAR EL DNS PROPIO
   Si el cliente quiere usar su propio dominio (ej. agrocore.suempresa.com)
   debe apuntarlo a la IP del servidor (A record).
   Si va a seguir usando $ClienteLower.agrocore.ar:
   - Editar el config.yml del tunel en TU PC (la de Sergio) y cambiar
     'service: http://localhost:$Puerto' por la nueva IP/dominio
   - O bien: instalar cloudflared en el servidor del cliente y migrarle el tunel.

============================================================
 IMPORTANTE - DESPUES DE MIGRAR:
============================================================

  - APAGAR la instancia de $Cliente en tu PC para evitar confusion:
    cd C:\AgroCore-$Cliente
    .\CERRAR-AGROCORE.bat

  - QUITAR del config.yml de Cloudflare la regla de $ClienteLower.agrocore.ar
    (o redirigir a la nueva IP).

  - GUARDAR este paquete por si hay que rehacer la migracion.

============================================================
"@
$readme | Out-File -FilePath "$paqueteDir\LEEME-INSTALACION.txt" -Encoding utf8

Write-Host "      OK README generado" -ForegroundColor Green

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  PAQUETE LISTO" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "  $paqueteDir"
Write-Host ""
Write-Host "  Comprimi la carpeta y mandasela al cliente o subila a su servidor."
Write-Host ""
