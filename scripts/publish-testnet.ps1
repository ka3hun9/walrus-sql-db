param(
  [string]$Address = "",
  [string]$Network = "testnet",
  [string]$GasBudget = "100000000"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command sui -ErrorAction SilentlyContinue)) {
  throw "sui CLI not found in PATH. Run scripts/install-sui-cli.ps1 first."
}

Write-Host "[1/6] Sui version"
sui --version

Write-Host "[2/6] Add/switch env -> $Network"
# Add env if missing (ignore errors if exists)
try { sui client new-env --alias $Network --rpc "https://fullnode.$Network.sui.io:443" } catch {}
sui client switch --env $Network

if ($Address -ne "") {
  Write-Host "[3/6] Ensure active address"
  # If address not in wallet, user needs import/mnemonic; here we just switch if exists.
  try { sui client switch --address $Address } catch {
    Write-Host "Address not found in local keystore. You may need: sui keytool import ..." -ForegroundColor Yellow
  }
}

Write-Host "[4/6] Active env/address"
sui client active-env
sui client active-address

Write-Host "[5/6] Publish Move package"
Set-Location (Join-Path $PSScriptRoot "..")
sui client publish --gas-budget $GasBudget contracts/walrus_sql | Tee-Object -FilePath publish-output.txt

Write-Host "[6/6] Done. Parse publish-output.txt for package ID and created objects."
Write-Host "Tip: send me publish-output.txt and I will wire SDK packageId immediately."
