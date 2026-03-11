param(
  [string]$EnvFile = ".env"
)

$ErrorActionPreference = "Stop"

if (!(Test-Path $EnvFile)) {
  throw "Missing $EnvFile. Copy .env.example to .env and fill SUI_PRIVATE_KEY first."
}

Write-Host "Running on-chain CRUD smoke test..."
npm run onchain:exec
