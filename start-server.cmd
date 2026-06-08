@echo off
cd /d "%~dp0"
echo Starting WedScene AI at http://127.0.0.1:5173
echo Press Ctrl+C in this window to stop the server.
D:\node.exe --env-file=.env server.mjs
pause
