@echo off
setlocal
title linear.pub
cd /d "%~dp0"
mode con: cols=82 lines=34 >nul 2>nul
set "SETUP_MARKER=%~dp0.linear-setup-ready"
cls

call :QuickReady
if errorlevel 1 (
  call :EnsureReady
  if errorlevel 1 (
    echo.
    echo Setup failed. Fix the message above, then open Get Loader.bat again.
    echo.
    pause
    exit /b 1
  )
)

cls
set "LINEAR_SHOW_BROWSER=1"
set "DEBUG="
set "PWDEBUG="
node get-loader.js
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo The loader script failed. Review the message above, then open Get Loader.bat again.
  echo.
  pause
)

exit /b %EXIT_CODE%

:QuickReady
call :RefreshNodePath
call :FindNode
if not defined NODE_FOUND exit /b 1
if not exist "package.json" exit /b 1

call :FindNpmPackages
if not defined NPM_PACKAGES_FOUND exit /b 1

call :FindPlaywrightChromiumFast
if not defined PLAYWRIGHT_CHROMIUM_FOUND exit /b 1

if not exist "%SETUP_MARKER%" call :WriteSetupMarker
exit /b 0

:EnsureReady
echo.
echo Preparing linear.pub...
echo.

call :RefreshNodePath
call :FindNode
if not defined NODE_FOUND (
  echo Node.js was not found. Installing Node.js LTS...
  call :InstallNode
  if errorlevel 1 exit /b 1
)

call :RefreshNodePath
call :FindNode
if not defined NODE_FOUND (
  echo Node.js was installed, but this window cannot see it yet.
  echo Close this window and open Get Loader.bat again.
  exit /b 1
)

for /f "usebackq delims=" %%V in (`node --version`) do set "NODE_VERSION=%%V"

if not exist "package.json" (
  echo package.json was not found in this folder.
  exit /b 1
)

call :FindNpmPackages
if defined NPM_PACKAGES_FOUND (
  rem Already installed.
) else (
  echo Installing npm dependencies...
  call npm.cmd install
  if errorlevel 1 (
    echo npm install failed.
    exit /b 1
  )
)

call :FindPlaywrightChromium
if defined PLAYWRIGHT_CHROMIUM_FOUND (
  rem Already installed.
) else (
  echo Installing Playwright Chromium...
  call npx.cmd playwright install chromium
  if errorlevel 1 (
    echo Playwright Chromium install failed.
    exit /b 1
  )

  call :FindPlaywrightChromium
  if not defined PLAYWRIGHT_CHROMIUM_FOUND (
    echo Playwright Chromium was not found after install.
    exit /b 1
  )
)

call :WriteSetupMarker
exit /b 0

:FindNode
set "NODE_FOUND="
where node >nul 2>nul
if not errorlevel 1 set "NODE_FOUND=1"
exit /b 0

:FindNpmPackages
set "NPM_PACKAGES_FOUND="
if exist "node_modules\playwright\package.json" if exist "node_modules\playwright-core\package.json" set "NPM_PACKAGES_FOUND=1"
exit /b 0

:FindPlaywrightChromiumFast
set "PLAYWRIGHT_CHROMIUM_FOUND="
if exist "%LOCALAPPDATA%\ms-playwright\" (
  pushd "%LOCALAPPDATA%\ms-playwright" >nul 2>nul
  if not errorlevel 1 (
    for /d %%D in (chromium-*) do (
      if exist "%%~fD\chrome-win\chrome.exe" set "PLAYWRIGHT_CHROMIUM_FOUND=1"
      if exist "%%~fD\chrome-win64\chrome.exe" set "PLAYWRIGHT_CHROMIUM_FOUND=1"
    )
    popd
  )
)
exit /b 0

:FindPlaywrightChromium
set "PLAYWRIGHT_CHROMIUM_FOUND="
set "PLAYWRIGHT_CHROMIUM_PATH="
for /f "usebackq delims=" %%P in (`node -e "const fs=require('fs');try{const { chromium }=require('playwright');const p=chromium.executablePath();if(fs.existsSync(p)){console.log(p);process.exit(0)}}catch(e){}process.exit(1)" 2^>nul`) do set "PLAYWRIGHT_CHROMIUM_PATH=%%P"
if defined PLAYWRIGHT_CHROMIUM_PATH set "PLAYWRIGHT_CHROMIUM_FOUND=1"
exit /b 0

:InstallNode
where winget >nul 2>nul
if errorlevel 1 (
  echo winget was not found, so Node.js cannot be installed automatically.
  echo Install Node.js LTS from https://nodejs.org/ and open Get Loader.bat again.
  start "" "https://nodejs.org/"
  exit /b 1
)

winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
if errorlevel 1 (
  echo Node.js install failed.
  exit /b 1
)

call :RefreshNodePath
exit /b 0

:RefreshNodePath
for %%D in ("%ProgramFiles%\nodejs" "%ProgramFiles(x86)%\nodejs" "%LOCALAPPDATA%\Programs\nodejs") do (
  if exist "%%~D\node.exe" set "PATH=%%~D;%PATH%"
)
exit /b 0

:WriteSetupMarker
> "%SETUP_MARKER%" echo ready
exit /b 0
