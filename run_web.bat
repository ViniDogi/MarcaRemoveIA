@echo off
chcp 65001 >nul
title MarcaRemoveIA Web Server (Node.js)
cd /d "%~dp0"

:: 1. Garante caminhos do Node.js, FFmpeg e yt-dlp no PATH
set "PATH=%PATH%;C:\Program Files\nodejs;%LOCALAPPDATA%\Programs\Git\cmd;%LOCALAPPDATA%\Microsoft\WinGet\Links;C:\Program Files\yt-dlp"

:: 2. Procura executável do node se ainda não estiver no PATH
where node >nul 2>&1
if %errorlevel% neq 0 (
    if exist "C:\Program Files\nodejs\node.exe" (
        set "PATH=%PATH%;C:\Program Files\nodejs"
    ) else (
        echo.
        echo ============================================================
        echo   [ERRO] Node.js nao foi encontrado no sistema!
        echo   Por favor, instale o Node.js v20+ em https://nodejs.org
        echo ============================================================
        echo.
        pause
        exit /b 1
    )
)

:: 3. Verifica se as dependências (node_modules) estão instaladas
if not exist "%~dp0node_modules" (
    echo ============================================================
    echo   [INFO] Primeira execucao detectada neste diretorio!
    echo   Instalando dependencias do Node.js (express, multer, etc)...
    echo   Aguarde alguns segundos enquanto o npm baixa os modulos...
    echo ============================================================
    echo.
    call npm.cmd install
    if %errorlevel% neq 0 (
        call npm install
    )
    if not exist "%~dp0node_modules" (
        echo [ERRO] Falha ao instalar dependencias com npm install.
        pause
        exit /b 1
    )
    echo.
    echo [OK] Dependencias instaladas com sucesso!
    echo.
)

echo ============================================================
echo   🚀 Servidor Web MarcaRemoveIA Node.js (ESM)
echo   👉 Acesse no navegador: http://127.0.0.1:8000
echo ============================================================
echo.

:: 4. Abre o navegador automaticamente
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:8000"

:: 5. Inicia o servidor Node.js
node "%~dp0src/server.js"

pause
