param([string]$OutputPath)

$ErrorActionPreference = 'Stop'
$output = if ($OutputPath) { [IO.Path]::GetFullPath($OutputPath) } else { Join-Path $PSScriptRoot 'Local CV Maker.exe' }
& (Join-Path $PSScriptRoot 'build.cmd') $output
if ($LASTEXITCODE -ne 0) { throw 'The executable build failed.' }
Get-Item -LiteralPath $output | Select-Object Name,Length
