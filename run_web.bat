@echo off
chcp 65001 >nul
title MarcaRemoveIA Web Server (Node.js)
cd /d "%~dp0"

:: Garante caminhos do Node.js, FFmpeg e yt-dlp no PATH
set "PATH=%PATH%;C:\Program Files\nodejs;%LOCALAPPDATA%\Programs\Git\cmd;%LOCALAPPDATA%\Microsoft\WinGet\Links;C:\Program Files\yt-dlp"

:: Procura executável do node se ainda não estiver no path
where node >nul 2>&1
if %errorlevel% neq 0 (
    if exist "C:\Program Files\nodejs\node.exe" (
        set "PATH=%PATH%;C:\Program Files\nodejs"
    ) else (
        echo [ERRO] Node.js nao foi encontrado no sistema!
        echo Por favor, instale o Node.js v20+ em https://nodejs.org
        pause
        exit /b 1
    )
)

:: Verifica se as dependências (node_modules) estão instaladas
if not exist "%~dp0node_modules" (
    echo [INFO] Primeira execucao: instalando dependencias (npm install)...
    call npm install
)

echo ============================================================
echo   🚀 Servidor Web MarcaRemoveIA Node.js (ESM)
echo   👉 Acesse no navegador: http://127.0.0.1:8000
echo ============================================================
echo.

:: Abre o navegador automaticamente
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:8000"

:: Inicia o servidor Node.js
node "%~dp0src/server.js"

pause
