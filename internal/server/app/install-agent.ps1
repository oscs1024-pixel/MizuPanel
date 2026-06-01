param(
  [string]$Binary,
  [string]$BinaryUrl,
  [string]$BinaryBaseUrl,
  [Parameter(Mandatory = $true)][string]$ServerUrl,
  [Parameter(Mandatory = $true)][string]$Token,
  [Parameter(Mandatory = $true)][string]$NodeId,
  [Parameter(Mandatory = $true)][string]$Name,
  [string]$Interval = "5s",
  [string]$InstallDir = "C:\Program Files\MizuPanel"
)

$ErrorActionPreference = "Stop"
$ServiceName = "mizupanel-agent"
$BinaryFileName = "mizupanel-agent-windows-amd64.exe"
$AgentPath = Join-Path $InstallDir "mizupanel-agent.exe"
$ConfigPath = Join-Path $InstallDir "agent.yaml"

function Test-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Resolve-BinarySource {
  $sources = @($Binary, $BinaryUrl, $BinaryBaseUrl) | Where-Object { $_ }
  if ($sources.Count -ne 1) {
    throw "Provide exactly one of -Binary, -BinaryUrl, or -BinaryBaseUrl."
  }
  if ($BinaryBaseUrl) {
    return ($BinaryBaseUrl.TrimEnd('/') + '/' + $BinaryFileName)
  }
  if ($BinaryUrl) {
    return $BinaryUrl
  }
  return $Binary
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
  throw "Administrator privileges are required to install MizuPanel Agent as a Windows service."
}

$BinarySource = Resolve-BinarySource
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

$ExistingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($ExistingService -and $ExistingService.Status -ne 'Stopped') {
  Stop-Service -Name $ServiceName -Force
}

if ($BinarySource -match '^https?://') {
  $TempBinary = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
  Invoke-WebRequest -Uri $BinarySource -UseBasicParsing -OutFile $TempBinary
  Move-Item -Force $TempBinary $AgentPath
} else {
  Copy-Item -Force $BinarySource $AgentPath
}

$config = @"
server:
  url: "$ServerUrl"
  token: "$Token"
node:
  id: "$NodeId"
  name: "$Name"
runtime:
  interval: "$Interval"
  mode: "normal"
features:
  docker: false
  terminal: false
"@
Set-Content -Path $ConfigPath -Value $config -Encoding UTF8

Invoke-Native icacls $InstallDir /inheritance:r /grant:r "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" "*S-1-5-19:(OI)(CI)RX"
Invoke-Native icacls $ConfigPath /inheritance:r /grant:r "*S-1-5-32-544:F" "*S-1-5-18:F" "*S-1-5-19:F"

$ServiceBinaryPath = "`"$AgentPath`" -config `"$ConfigPath`""
if ($ExistingService) {
  Invoke-Native sc.exe config $ServiceName binPath= $ServiceBinaryPath DisplayName= "MizuPanel Agent" start= auto obj= "NT AUTHORITY\LocalService"
} else {
  Invoke-Native sc.exe create $ServiceName binPath= $ServiceBinaryPath DisplayName= "MizuPanel Agent" start= auto obj= "NT AUTHORITY\LocalService"
}

Start-Service -Name $ServiceName
Write-Output "MizuPanel agent installed."
Write-Output "Config: $ConfigPath"
