# ============================================================
# AgroCore — setup de la base de datos (corre durante la instalación)
# Crea el usuario "agrocore", la base "agrocore", y configura el .env.
# ============================================================
param(
  [Parameter(Mandatory=$true)][string]$InstallDir,
  [string]$DbPassword = ""
)

$ErrorActionPreference = "Continue"
$logFile = "$env:TEMP\agrocore-install.log"
function Log($msg) { Add-Content -Path $logFile -Value "[$(Get-Date -Format 'HH:mm:ss')] $msg" }
Log "=== setup-database.ps1 ==="

# Encontrar pg_dump / psql en PATH o en la instalación típica
$pgBin = $null
foreach ($v in @("18","17","16","15","14")) {
  if (Test-Path "C:\Program Files\PostgreSQL\$v\bin\psql.exe") { $pgBin = "C:\Program Files\PostgreSQL\$v\bin"; break }
}
if (-not $pgBin) {
  Log "ERROR: No se encontró PostgreSQL instalado."
  Write-Error "PostgreSQL no está instalado o no se encontró en C:\Program Files\PostgreSQL\<ver>"
  exit 1
}
Log "PostgreSQL bin: $pgBin"
$psql = Join-Path $pgBin "psql.exe"

# Password para el usuario agrocore — random si no se pasó
if (-not $DbPassword) {
  $DbPassword = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | ForEach-Object {[char]$_})
}

# Conectarse como postgres (password seteada en la instalación de PG: agrocore123)
$env:PGPASSWORD = "agrocore123"

# Crear la base y el usuario si no existen
$sqlCreate = @"
DO `$`$
BEGIN
   IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'agrocore') THEN
      CREATE ROLE agrocore LOGIN PASSWORD '$DbPassword';
   ELSE
      ALTER ROLE agrocore WITH PASSWORD '$DbPassword';
   END IF;
END
`$`$;
"@
$sqlCreate | & $psql -U postgres -h 127.0.0.1 -d postgres 2>&1 | ForEach-Object { Log $_ }

# Crear la base si no existe (CREATE DATABASE no puede ir en DO bloque)
$dbExists = & $psql -U postgres -h 127.0.0.1 -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='agrocore'" 2>$null
if (-not $dbExists) {
  Log "Creando base de datos agrocore..."
  & $psql -U postgres -h 127.0.0.1 -d postgres -c "CREATE DATABASE agrocore OWNER agrocore" 2>&1 | ForEach-Object { Log $_ }
} else {
  Log "Base agrocore ya existe."
}

# Escribir .env del backend con el DATABASE_URL
$envPath = Join-Path $InstallDir "backend\.env"
$jwtSecret = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 48 | ForEach-Object {[char]$_})
$envContent = @"
DATABASE_URL=postgresql://agrocore:$DbPassword@localhost:5432/agrocore?schema=public
JWT_SECRET=$jwtSecret
PORT=3100
HOST=0.0.0.0
"@
Set-Content -Path $envPath -Value $envContent -Encoding UTF8
Log ".env escrito en $envPath"

Write-Host "OK setup-database"
Log "=== setup-database OK ==="
exit 0
