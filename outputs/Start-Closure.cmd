@echo off
setlocal
if not exist "%~dp0closure-companion\launch.cmd" exit /b 2
call "%~dp0closure-companion\launch.cmd" --standalone
exit /b %ERRORLEVEL%
