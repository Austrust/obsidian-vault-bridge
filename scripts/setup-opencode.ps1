param(
  [string]$Destination = (Join-Path $env:LOCALAPPDATA 'VaultBridge/OpenCode/1.19.0'),
  [ValidateSet('x64','arm64')][string]$Architecture = 'x64'
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$runtimeTarget = [IO.Path]::GetFullPath($Destination)
$runtimeExe = Join-Path $runtimeTarget 'opencode.exe'
if (Test-Path -LiteralPath $runtimeExe) {
  $installedVersion = (& $runtimeExe --version | Out-String).Trim()
  if ($LASTEXITCODE -eq 0 -and $installedVersion -eq '1.19.0') {
    Write-Output "OpenCode 1.19.0 is ready: $runtimeExe"
    exit 0
  }
  throw 'Destination contains another executable. Choose a new empty directory.'
}
if ((Test-Path -LiteralPath $runtimeTarget) -and (Get-ChildItem -LiteralPath $runtimeTarget -Force | Select-Object -First 1)) {
  throw 'Destination must be empty. Existing files will not be replaced.'
}
$expected = @{
  x64 = '17108e9448c4fdad48eb8714c4ed6f5dfc9cf86c2eb8f2ce5d02043fef806eb5'
  arm64 = 'cfb6f1d40c4596613d2d40e34c48500da7b873f98f7458d3d4ea11136bf174f6'
}
$runtimeArchive = Join-Path ([IO.Path]::GetTempPath()) ('vaultbridge-opencode-' + [guid]::NewGuid().ToString() + '.zip')
$runtimeUrl = "https://github.com/anomalyco/opencode/releases/download/v1.19.0/opencode-windows-$Architecture.zip"
Invoke-WebRequest -Uri $runtimeUrl -OutFile $runtimeArchive
if ((Get-FileHash -LiteralPath $runtimeArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected[$Architecture]) {
  throw 'Official archive checksum mismatch; nothing was installed.'
}
New-Item -ItemType Directory -Path $runtimeTarget -Force | Out-Null
Expand-Archive -LiteralPath $runtimeArchive -DestinationPath $runtimeTarget
if (-not (Test-Path -LiteralPath $runtimeExe -PathType Leaf)) { throw 'Archive does not contain opencode.exe.' }
$installedVersion = (& $runtimeExe --version | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $installedVersion -ne '1.19.0') { throw 'Installed executable failed its version check.' }
Remove-Item -LiteralPath $runtimeArchive
Write-Output "OpenCode 1.19.0 verified: $runtimeExe"
Write-Output 'Return to VaultBridge settings and select this executable, or use automatic detection.'
