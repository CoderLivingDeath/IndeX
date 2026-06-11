@echo off
cd /d "%~dp0"
set "PATH=%USERPROFILE%\.bun\bin;%PATH%"
echo Starting IndeX API server...
echo.
bun run src/presentation/api/server.ts
pause