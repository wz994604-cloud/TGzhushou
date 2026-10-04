param([Parameter(Mandatory=$true)][string]$Target,[Parameter(Mandatory=$true)][string]$Backup)
$ErrorActionPreference='Stop'
Copy-Item -LiteralPath $Backup -Destination $Target -Force
Write-Output "ROLLBACK_OK target=$Target backup=$Backup"
