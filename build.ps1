param([string]$OutputPath)

$ErrorActionPreference = 'Stop'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (!(Test-Path -LiteralPath $compiler)) { throw 'This build requires the Windows .NET Framework C# compiler.' }
$root = $PSScriptRoot
$output = if ($OutputPath) { [IO.Path]::GetFullPath($OutputPath) } else { Join-Path $root 'Local CV Maker.exe' }
$arguments = @(
    '/nologo', '/target:winexe', '/optimize+', '/platform:anycpu', '/codepage:65001',
    '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/reference:System.Web.Extensions.dll', '/reference:System.Security.dll',
    ('/out:' + $output)
)
foreach ($asset in @('index.html', 'styles.css', 'app.js', 'privacy.mjs')) {
    $arguments += '/resource:' + (Join-Path $root "dist/$asset") + ',' + $asset
}
foreach ($source in @('Program.cs', 'LocalServer.cs', 'CvContract.cs', 'Mcp.cs')) {
    $arguments += Join-Path $root "src/$source"
}
& $compiler @arguments
if ($LASTEXITCODE -ne 0) { throw 'The executable build failed.' }
Get-Item -LiteralPath $output | Select-Object Name,Length
