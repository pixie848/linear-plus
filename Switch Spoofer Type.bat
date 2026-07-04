@echo off
setlocal
title Switch Spoofer Type
cd /d "%~dp0"
mode con: cols=64 lines=20 >nul 2>nul
cls

call :RefreshNodePath
call :FindNode
if not defined NODE_FOUND (
  echo.
  echo Node.js was not found. Open Get Loader.bat once to set things up,
  echo then run Switch Spoofer Type.bat again.
  echo.
  pause
  exit /b 1
)

node set-exe-type.js
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo Could not switch the spoofer type. Review the message above.
  echo.
  pause
)

exit /b %EXIT_CODE%

:FindNode
set "NODE_FOUND="
where node >nul 2>nul
if not errorlevel 1 set "NODE_FOUND=1"
exit /b 0

:RefreshNodePath
for %%D in ("%ProgramFiles%\nodejs" "%ProgramFiles(x86)%\nodejs" "%LOCALAPPDATA%\Programs\nodejs") do (
  if exist "%%~D\node.exe" set "PATH=%%~D;%PATH%"
)
exit /b 0
