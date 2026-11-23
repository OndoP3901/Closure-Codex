@echo off
setlocal
if not exist "%~dp0outputs\closure-companion\launch.cmd" (
    echo Closure desktop pet is missing. Extract the release package again.
    pause
    exit /b 1
)
call "%~dp0outputs\closure-companion\launch.cmd" --standalone
exit /b %ERRORLEVEL%
