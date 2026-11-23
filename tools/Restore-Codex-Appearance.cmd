@echo off
setlocal DisableDelayedExpansion
if /i "%~1"=="--debug" goto debug
start "" "%SystemRoot%\System32\wscript.exe" //Nologo "%~dp0..\Restore-Codex-Appearance.vbs"
exit /b
:debug
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\outputs\closure-decoration\Theme.ps1" -Mode disable
if errorlevel 1 pause
