@echo off
setlocal EnableExtensions
title Stronghold Protocol - Hexmods
pushd "%~dp0"
if errorlevel 1 goto :pathfail
if not exist "Hexmods\manage.cjs" goto :missing

set "MODE=on"
if "%1"=="" goto :argsdone
if not "%~1"=="--mode" goto :badmode
if "%~2"=="on" goto :validmode
if "%~2"=="off" goto :validmode
goto :badmode

:validmode
set "MODE=%~2"
shift
shift
if not "%1"=="" goto :badmode

:argsdone

set "PORT=3140"
set "SP_VERSIONS=act3autochess@V3_1"
set "SP_VERSION_DEFAULT=act3autochess@V3_1"
set "NODE_EXE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node.exe"

"%NODE_EXE%" "Hexmods\manage.cjs" start --mode "%MODE%"
set "LAUNCH_EXIT=%ERRORLEVEL%"
popd
exit /b %LAUNCH_EXIT%

:badmode
echo [ERROR] Usage: Start.cmd [--mode on^|off]
popd
exit /b 2

:missing
echo [ERROR] Hexmods\manage.cjs was not found.
echo Keep Start.cmd in the game root folder.
popd
pause
exit /b 1

:pathfail
echo [ERROR] Cannot access the game folder.
pause
exit /b 1
