@echo off
cd /d "%~dp0"
echo Stopping any old copy of the backend...
taskkill /F /IM node.exe >nul 2>&1
echo Starting the Bandwidth backend. Keep this window open while you use the extension.
echo.
node server.js
echo.
echo The backend stopped. Press any key to close this window.
pause >nul
