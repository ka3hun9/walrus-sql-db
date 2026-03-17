param(
  [string]$ReportsDir = "reports/p2-evidence",
  [string]$Network = "testnet"
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

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$runDir = Join-Path $ReportsDir ("$timestamp-p2-mile-008")
New-Item -ItemType Directory -Force -Path $runDir | Out-Null

$acceptanceLog = Join-Path $runDir "acceptance-suite.log"
$tpccReportPath = Join-Path $runDir "tpcc-conflict-baseline.json"
$soakReportPath = Join-Path $runDir "tpcc-soak.json"
$summaryPath = Join-Path $runDir "evidence-summary.json"
$reportPath = Join-Path $runDir "p2-mile-008-txn-conflict-recovery-report.md"

Write-Host "[1/5] build"
npm run build
if ($LASTEXITCODE -ne 0) { throw "build failed" }

Write-Host "[2/5] run txn/conflict/recovery acceptance subset"
$tests = @(
  "test/unit-c-exec-010-transaction-atomic-commit.ts",
  "test/unit-c-exec-011-transaction-rollback-consistency.ts",
  "test/unit-c-exec-013-read-committed-view.ts",
  "test/unit-p2-exe-002-commit-revalidation.ts",
  "test/unit-g-stor-013-crash-recovery-wal-version-chain.ts",
  "test/unit-g-stor-015-pending-confirmed-read-strategy.ts"
)

$accLines = @()
foreach ($t in $tests) {
  $line = "[RUN] $t"
  Write-Host $line
  $accLines += $line
  $out = node node_modules/tsx/dist/cli.mjs $t 2>&1
  $out | ForEach-Object { Write-Host $_; $accLines += "$_" }
  if ($LASTEXITCODE -ne 0) {
    $accLines | Set-Content -Encoding UTF8 $acceptanceLog
    throw "acceptance test failed: $t"
  }
}
$accLines | Set-Content -Encoding UTF8 $acceptanceLog

Write-Host "[3/5] run tpcc conflict baseline"
node node_modules/tsx/dist/cli.mjs examples/sql-tpcc-like-benchmark.ts $tpccReportPath 1200 2 240
if ($LASTEXITCODE -ne 0) { throw "tpcc conflict baseline failed" }

Write-Host "[4/5] run tpcc soak"
node node_modules/tsx/dist/cli.mjs examples/sql-tpcc-like-soak.ts $soakReportPath 30000
if ($LASTEXITCODE -ne 0) { throw "tpcc soak failed" }

Write-Host "[5/5] summarize evidence"
$tpcc = Get-Content $tpccReportPath -Raw | ConvertFrom-Json
$soak = Get-Content $soakReportPath -Raw | ConvertFrom-Json

$summary = [pscustomobject]@{
  generatedAt = (Get-Date).ToString("o")
  network = $Network
  acceptance = [pscustomobject]@{
    tests = $tests
    passed = $true
    log = (Split-Path -Leaf $acceptanceLog)
  }
  tpccConflict = [pscustomobject]@{
    attempted = $tpcc.attemptedTransactions
    committed = $tpcc.committedTransactions
    aborted = $tpcc.abortedTransactions
    conflicts = $tpcc.conflictsDetected
    throughputTps = $tpcc.throughputTps
    consistencyErrors = @($tpcc.consistencyErrors)
  }
  tpccSoak = [pscustomobject]@{
    durationMs = $soak.durationMs
    runs = $soak.runs
    attempted = $soak.totalAttempted
    committed = $soak.totalCommitted
    aborted = $soak.totalAborted
    conflicts = $soak.totalConflicts
    consistencyErrors = @($soak.consistencyErrors)
  }
  passCriteria = [pscustomobject]@{
    tpccConflictConsistencyZero = (@($tpcc.consistencyErrors).Count -eq 0)
    tpccSoakConsistencyZero = (@($soak.consistencyErrors).Count -eq 0)
  }
}
$summary | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 $summaryPath

$allGreen = $summary.passCriteria.tpccConflictConsistencyZero -and $summary.passCriteria.tpccSoakConsistencyZero

$sb = New-Object System.Text.StringBuilder
$null = $sb.AppendLine("# P2 Mile-008 Txn Conflict & Recovery Evidence Report")
$null = $sb.AppendLine()
$null = $sb.AppendLine("- generatedAt: $($summary.generatedAt)")
$null = $sb.AppendLine("- network: $($summary.network)")
$null = $sb.AppendLine("- acceptance passed: $($summary.acceptance.passed)")
$null = $sb.AppendLine("- tpcc conflict consistency errors: $(@($summary.tpccConflict.consistencyErrors).Count)")
$null = $sb.AppendLine("- tpcc soak consistency errors: $(@($summary.tpccSoak.consistencyErrors).Count)")
$null = $sb.AppendLine("- overall: $allGreen")
$null = $sb.AppendLine()
$null = $sb.AppendLine("## TPCC Conflict Baseline")
$null = $sb.AppendLine("- attempted=$($summary.tpccConflict.attempted), committed=$($summary.tpccConflict.committed), aborted=$($summary.tpccConflict.aborted)")
$null = $sb.AppendLine("- conflicts=$($summary.tpccConflict.conflicts), throughputTps=$($summary.tpccConflict.throughputTps)")
$null = $sb.AppendLine()
$null = $sb.AppendLine("## TPCC Soak")
$null = $sb.AppendLine("- durationMs=$($summary.tpccSoak.durationMs), runs=$($summary.tpccSoak.runs)")
$null = $sb.AppendLine("- attempted=$($summary.tpccSoak.attempted), committed=$($summary.tpccSoak.committed), aborted=$($summary.tpccSoak.aborted), conflicts=$($summary.tpccSoak.conflicts)")
$null = $sb.AppendLine()
$null = $sb.AppendLine("## Artifacts")
$null = $sb.AppendLine("- $(Split-Path -Leaf $acceptanceLog)")
$null = $sb.AppendLine("- $(Split-Path -Leaf $tpccReportPath)")
$null = $sb.AppendLine("- $(Split-Path -Leaf $soakReportPath)")
$null = $sb.AppendLine("- $(Split-Path -Leaf $summaryPath)")

$sb.ToString() | Set-Content -Encoding UTF8 $reportPath

Write-Host "Done. Evidence written to: $runDir"
if (-not $allGreen) {
  throw "consistency criteria not satisfied, check $summaryPath"
}
