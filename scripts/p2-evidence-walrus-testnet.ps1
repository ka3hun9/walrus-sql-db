param(
  [string]$Network = "testnet",
  [string]$ReportsDir = "reports/p2-evidence",
  [string]$EnvFile = ".env"
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

function Assert-Cmd([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $Name"
  }
}

Assert-Cmd node
Assert-Cmd npm
Assert-Cmd sui

if (-not (Test-Path $EnvFile)) {
  throw "Missing $EnvFile. Copy .env.example to .env and set SUI_PRIVATE_KEY/WALRUS_SQL_PACKAGE_ID/WALRUS_SQL_CATALOG_ID first."
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$runDir = Join-Path $ReportsDir $timestamp
New-Item -ItemType Directory -Force -Path $runDir | Out-Null

$rawLog = Join-Path $runDir "onchain-exec.log"
$summaryJsonPath = Join-Path $runDir "evidence-summary.json"
$reportMdPath = Join-Path $runDir "p2-mile-007-walrus-testnet-evidence-report.md"

Write-Host "[1/6] Build"
npm run build
if ($LASTEXITCODE -ne 0) { throw "build failed" }

Write-Host "[2/6] Run on-chain CRUD smoke"
$execOut = npm run onchain:exec 2>&1
$execOut | Tee-Object -FilePath $rawLog | Out-Host
if ($LASTEXITCODE -ne 0) { throw "onchain:exec failed" }

Write-Host "[3/6] Parse tx digests + table id"
$lines = @($execOut | ForEach-Object { "$($_)" })
$txs = @()
$tableId = $null
foreach ($line in $lines) {
  $m = [regex]::Match($line, '^(CREATE|INSERT|UPDATE|DELETE) tx:\s*([A-Za-z0-9]+)')
  if ($m.Success) {
    $txs += [pscustomobject]@{
      operation = $m.Groups[1].Value
      digest = $m.Groups[2].Value
    }
  }
  $tm = [regex]::Match($line, 'tableId:\s*(0x[0-9a-fA-F]+)')
  if ($tm.Success) {
    $tableId = $tm.Groups[1].Value
  }
}

if ($txs.Count -lt 4) {
  throw "Cannot parse enough tx digests from onchain output. See $rawLog"
}

Write-Host "[4/6] Fetch on-chain tx proofs"
$proofs = @()
$idx = 0
foreach ($tx in $txs) {
  $idx += 1
  $proofPath = Join-Path $runDir ("tx-{0:D2}-{1}.json" -f $idx, $tx.operation.ToLower())
  $proofRaw = sui client tx-block $tx.digest --json 2>&1
  $proofRaw | Set-Content -Encoding UTF8 $proofPath

  $status = "unknown"
  $effectsDigest = $null
  $createdCount = 0
  try {
    $proof = ($proofRaw -join "`n") | ConvertFrom-Json
    $status = "$($proof.effects.status.status)"
    $effectsDigest = "$($proof.digest)"
    if ($proof.objectChanges) {
      $createdCount = @($proof.objectChanges | Where-Object { $_.type -eq "created" }).Count
    }
  } catch {
    $status = "parse_error"
  }

  $proofs += [pscustomobject]@{
    operation = $tx.operation
    digest = $tx.digest
    status = $status
    proofPath = (Split-Path -Leaf $proofPath)
    createdObjects = $createdCount
    chainDigest = $effectsDigest
  }
}

Write-Host "[5/6] Write summary JSON"
$summary = [pscustomobject]@{
  generatedAt = (Get-Date).ToString("o")
  network = $Network
  env = [pscustomobject]@{
    rpc = $env:SUI_RPC_URL
    packageId = $env:WALRUS_SQL_PACKAGE_ID
    catalogId = $env:WALRUS_SQL_CATALOG_ID
  }
  tableId = $tableId
  txCount = $proofs.Count
  txs = $proofs
  allSuccess = (@($proofs | Where-Object { $_.status -ne "success" }).Count -eq 0)
}
$summary | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 $summaryJsonPath

Write-Host "[6/6] Render markdown report"
$sb = New-Object System.Text.StringBuilder
$null = $sb.AppendLine("# P2 Mile-007 Walrus Testnet Evidence Report")
$null = $sb.AppendLine()
$null = $sb.AppendLine("- generatedAt: $($summary.generatedAt)")
$null = $sb.AppendLine("- network: $($summary.network)")
$null = $sb.AppendLine("- packageId: $($summary.env.packageId)")
$null = $sb.AppendLine("- catalogId: $($summary.env.catalogId)")
$null = $sb.AppendLine("- rpc: $($summary.env.rpc)")
$null = $sb.AppendLine("- tableId: $($summary.tableId)")
$null = $sb.AppendLine("- allSuccess: $($summary.allSuccess)")
$null = $sb.AppendLine()
$null = $sb.AppendLine("## Transactions")
foreach ($p in $proofs) {
  $null = $sb.AppendLine("- [$($p.operation)] digest=$($p.digest), status=$($p.status), proof=$($p.proofPath), createdObjects=$($p.createdObjects)")
}
$null = $sb.AppendLine()
$null = $sb.AppendLine("## Artifacts")
$null = $sb.AppendLine("- onchain-exec.log")
$null = $sb.AppendLine("- evidence-summary.json")
$null = $sb.AppendLine("- tx-*.json")

$sb.ToString() | Set-Content -Encoding UTF8 $reportMdPath

Write-Host "Done. Evidence written to: $runDir"
if (-not $summary.allSuccess) {
  throw "Some transactions are not success. Check $summaryJsonPath"
}
