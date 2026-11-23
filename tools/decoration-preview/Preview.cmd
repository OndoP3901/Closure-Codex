@echo off
setlocal DisableDelayedExpansion
set "ELECTRON_RUN_AS_NODE="
if not defined CLOSURE_ELECTRON_EXE set "CLOSURE_ELECTRON_EXE=%~dp0..\..\work\companion-runtime\electron\electron.exe"
if not exist "%CLOSURE_ELECTRON_EXE%" (
    echo Electron is missing. Set CLOSURE_ELECTRON_EXE to your Electron executable.
    pause
    exit /b 1
)
start "" "%CLOSURE_ELECTRON_EXE%" "%~dp0preview.cjs"
