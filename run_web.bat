@echo off
setlocal
cd /d "%~dp0"

set "PATH=%PATH%;C:\Program Files\nodejs;%LOCALAPPDATA%\Programs\Git\cmd;%LOCALAPPDATA%\Microsoft\WinGet\Links;%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg.Essentials_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.1-essentials_build\bin;%LOCALAPPDATA%\Microsoft\WinGet\Packages\yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe;C:\Program Files\yt-dlp"

if not exist "%~dp0node_modules" (
    echo [INFO] Instalando dependencias do Node.js...
    call npm install
)

echo ============================================================
echo   Servidor Web MarcaRemoveIA Node.js
echo   Acesse no navegador: http://127.0.0.1:8000
echo ============================================================
echo.

start "" cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:8000"
node "%~dp0src\server.js"
pause