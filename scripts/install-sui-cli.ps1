param(
  [string]$Version = "testnet-v1.67.2",
  [string]$InstallDir = "$env:USERPROFILE\\.local\\bin"
)

$ErrorActionPreference = "Stop"

Write-Host "[1/5] Resolving release asset for $Version ..."
$asset = "sui-$Version-windows-x86_64.tgz"
$url = "https://github.com/MystenLabs/sui/releases/download/$Version/$asset"

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
New-Item -ItemType Directory -Force -Path "$PSScriptRoot\\tools" | Out-Null

$tgzPath = "$PSScriptRoot\\tools\\$asset"
$extractDir = "$PSScriptRoot\\tools\\sui-$Version"

Write-Host "[2/5] Downloading $url"
Invoke-WebRequest -Uri $url -OutFile $tgzPath

Write-Host "[3/5] Extracting archive ..."
if (Test-Path $extractDir) { Remove-Item -Recurse -Force $extractDir }
New-Item -ItemType Directory -Force -Path $extractDir | Out-Null

# Windows 10+ tar supports .tgz
& tar -xzf $tgzPath -C $extractDir

# find sui.exe
$suiExe = Get-ChildItem -Path $extractDir -Recurse -Filter sui.exe | Select-Object -First 1
if (-not $suiExe) {
  throw "sui.exe not found after extraction."
}

Write-Host "[4/5] Installing sui.exe -> $InstallDir"
Copy-Item -Force $suiExe.FullName (Join-Path $InstallDir "sui.exe")

Write-Host "[5/5] Verifying installation ..."
$installed = Join-Path $InstallDir "sui.exe"
& $installed --version

if (($env:Path -split ';') -notcontains $InstallDir) {
  Write-Host "\nNOTE: $InstallDir is not in PATH for current shell."
  Write-Host "Add it permanently with:"
  Write-Host "  setx PATH \"$($env:Path);$InstallDir\""
  Write-Host "Then open a new terminal."
}

Write-Host "\nDone."
