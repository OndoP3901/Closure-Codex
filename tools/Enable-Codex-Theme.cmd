@echo off
setlocal DisableDelayedExpansion
if /i "%~1"=="--debug" goto debug
start "" "%SystemRoot%\System32\wscript.exe" //Nologo "%~dp0..\Enable-Codex-Theme.vbs"
exit /b
:debug
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\outputs\closure-decoration\Theme.ps1" -Mode enable
if errorlevel 1 pause
