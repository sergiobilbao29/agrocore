# ============================================================
# AgroCore — post-install (npm install + prisma + seed)
# ============================================================
param(
  [Parameter(Mandatory=$true)][string]$InstallDir
)

$ErrorActionPreference = "Continue"
$logFile = "$env:TEMP\agrocore-install.log"
function Log($msg) { Add-Content -Path $logFile -Value "[$(Get-Date -Format 'HH:mm:ss')] $msg" }
Log "=== post-install.ps1 ==="

$backend = Join-Path $InstallDir "backend"
if (-not (Test-Path $backend)) {
  Log "ERROR: No existe $backend"
  exit 1
}

Push-Location $backend
try {
  Log "npm install..."
  & npm install --omit=dev --no-audit --no-fund --loglevel=error 2>&1 | ForEach-Object { Log $_ }
  if ($LASTEXITCODE -ne 0) { Log "ERROR npm install"; exit 2 }

  Log "prisma generate..."
  & npx prisma generate 2>&1 | ForEach-Object { Log $_ }

  Log "prisma migrate deploy..."
  & npx prisma migrate deploy 2>&1 | ForEach-Object { Log $_ }
  if ($LASTEXITCODE -ne 0) { Log "ERROR migrate deploy"; exit 3 }

  # Seed inicial (super admin + catálogos básicos) — solo si la base está vacía
  $hasUsers = & npx prisma db execute --stdin --schema=prisma/schema.prisma <<< "SELECT 1 FROM \"User\" LIMIT 1;" 2>$null
  if (-not $hasUsers) {
    Log "Corriendo seed inicial..."
    if (Test-Path "prisma\seed.js") { & node "prisma\seed.js" 2>&1 | ForEach-Object { Log $_ } }
    if (Test-Path "prisma\seed-maestros.js") { & node "prisma\seed-maestros.js" 2>&1 | ForEach-Object { Log $_ } }
  } else {
    Log "Base ya tiene usuarios, no se ejecuta seed."
  }

  Log "post-install OK"
  exit 0
} finally {
  Pop-Location
}
