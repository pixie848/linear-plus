@echo off
setlocal
title Uninstall Linear Loader
cd /d "%~dp0"

set "APP_DIR=%~dp0"
set "APP_DIR=%APP_DIR:~0,-1%"
set "USER_STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "COMMON_STARTUP=%ProgramData%\Microsoft\Windows\Start Menu\Programs\Startup"
set "WARMUP_NAME=Linear Loader Warmup"
set "HELPER=%TEMP%\linear-loader-uninstall-%RANDOM%-%RANDOM%.cmd"

echo.
echo This will uninstall Linear Loader from:
echo "%APP_DIR%"
echo.
echo It will remove:
echo - Windows Startup warmup entries
echo - downloaded loaders
echo - node_modules and setup files
echo - keys.txt and the rest of this folder
echo.

echo.
echo Removing Startup warmup entries...
call :DeleteStartupEntry "%USER_STARTUP%"
call :DeleteStartupEntry "%COMMON_STARTUP%"

echo Removing app files...
> "%HELPER%" echo @echo off
>> "%HELPER%" echo timeout /t 2 /nobreak ^>nul
>> "%HELPER%" echo rmdir /s /q "%APP_DIR%" ^>nul 2^>nul
>> "%HELPER%" echo del /f /q "%%~f0" ^>nul 2^>nul

start "" /min cmd /c "%HELPER%"

echo.
echo Uninstall started. You can close this window.
timeout /t 2 /nobreak >nul
exit /b 0

:DeleteStartupEntry
set "STARTUP_DIR=%~1"
if not defined STARTUP_DIR exit /b 0

if exist "%STARTUP_DIR%\%WARMUP_NAME%.cmd" del /f /q "%STARTUP_DIR%\%WARMUP_NAME%.cmd" >nul 2>nul
if exist "%STARTUP_DIR%\%WARMUP_NAME%.bat" del /f /q "%STARTUP_DIR%\%WARMUP_NAME%.bat" >nul 2>nul
if exist "%STARTUP_DIR%\%WARMUP_NAME%.lnk" del /f /q "%STARTUP_DIR%\%WARMUP_NAME%.lnk" >nul 2>nul
exit /b 0
