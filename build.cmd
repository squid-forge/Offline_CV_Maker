@echo off
setlocal DisableDelayedExpansion

set "localCvCompiler=%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%localCvCompiler%" set "localCvCompiler=%SystemRoot%\Microsoft.NET\Framework\v4.0.30319\csc.exe"
if not exist "%localCvCompiler%" (
  >&2 echo The Windows .NET Framework C# compiler was not found.
  exit /b 1
)

set "localCvOutput=%~dp0Local CV Maker.exe"
if not "%~1"=="" set "localCvOutput=%~f1"

pushd "%~dp0" || exit /b 1
"%localCvCompiler%" /nologo /target:winexe /optimize+ /platform:anycpu /codepage:65001 ^
  "/out:%localCvOutput%" ^
  /reference:System.Windows.Forms.dll /reference:System.Drawing.dll ^
  /reference:System.Web.Extensions.dll /reference:System.Security.dll ^
  /resource:dist\index.html,index.html /resource:dist\styles.css,styles.css ^
  /resource:dist\app.js,app.js /resource:dist\privacy.mjs,privacy.mjs ^
  /resource:LICENSE,LICENSE ^
  src\Program.cs src\LocalServer.cs src\CvContract.cs src\Mcp.cs
set "localCvBuildResult=%ERRORLEVEL%"
popd

if not "%localCvBuildResult%"=="0" (
  >&2 echo Build failed. If Local CV Maker is open, quit it from the system tray and try again.
  exit /b %localCvBuildResult%
)
echo Built "%localCvOutput%"
