@echo off
setlocal
cd /d "%~dp0"

set "PATH=%PATH%;C:\Program Files\nodejs;%LOCALAPPDATA%\Microsoft\WinGet\Links;C:\Program Files\yt-dlp"

echo ============================================================
echo   Iniciando MarcaRemoveIA com Acesso Remoto Publico
echo ============================================================
echo.

start "" "%~dp0run_web.bat"

echo Aguardando servidor iniciar...
timeout /t 3 /nobreak >nul

echo.
echo ============================================================
echo   Gerando link publico HTTPS (acessivel de qualquer lugar)...
echo   Copie o link gerado abaixo para acessar no celular ou outro PC!
echo ============================================================
echo.
call npx.cmd localtunnel --port 8000
pause