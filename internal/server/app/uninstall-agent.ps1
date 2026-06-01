param(
  [string]$InstallDir = "C:\Program Files\MizuPanel"
)

$ErrorActionPreference = "Stop"
$ServiceName = "mizupanel-agent"

function Test-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Invoke-Native {
  $command = $args[0]
  $commandArgs = @()
  if ($args.Count -gt 1) {
    $commandArgs = $args[1..($args.Count - 1)]
  }
  & $command @commandArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code $LASTEXITCODE: $command $($commandArgs -join ' ')"
  }
}

if (-not (Test-Administrator)) {
  throw "Administrator privileges are required to uninstall MizuPanel Agent."
}

$ExistingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($ExistingService) {
  if ($ExistingService.Status -ne 'Stopped') {
    Stop-Service -Name $ServiceName -Force
  }
  Invoke-Native sc.exe delete $ServiceName
}

if (Test-Path -LiteralPath $InstallDir) {
  Remove-Item -LiteralPath $InstallDir -Recurse -Force
}

Write-Output "MizuPanel agent uninstalled."
