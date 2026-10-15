@echo off
chcp 65001 >nul
title Publicar MarcaRemoveIA no GitHub

set "PATH=%PATH%;%LOCALAPPDATA%\Programs\Git\cmd;%LOCALAPPDATA%\Programs\gh\bin;C:\Program Files\Git\cmd;C:\Program Files\GitHub CLI"

echo ============================================================
echo   🚀 Publicar MarcaRemoveIA no GitHub
echo ============================================================
echo.

:: Verifica se o GitHub CLI está autenticado
gh auth status >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Voce ja esta autenticado no GitHub!
    goto CREATE_REPO
)

echo [!] Voce precisa conectar sua conta do GitHub uma unica vez.
echo Escolha como deseja autenticar:
echo   1. Fazer login no navegador (Recomendado - Rapido)
echo   2. Ja tenho um repositorio criado e quero apenas colar a URL
echo.
set /p opt="Digite sua opcao (1 ou 2): "

if "%opt%"=="2" goto PUSH_EXISTING

:LOGIN_GH
echo.
echo Abrindo autenticacao no navegador...
gh auth login --web -p https
if %errorlevel% neq 0 (
    echo Falha na autenticacao.
    pause
    exit /b
)

:CREATE_REPO
echo.
echo Criando o repositorio MarcaRemoveIA na sua conta do GitHub e enviando o codigo...
gh repo create MarcaRemoveIA --public --source=. --remote=origin --push
if %errorlevel% equ 0 (
    echo.
    echo ============================================================
    echo   [SUCESSO] Repositorio publicado no GitHub com sucesso!
    echo ============================================================
) else (
    echo.
    echo [AVISO] Se o repositorio ja existia, enviando branch main...
    git push -u origin main
)
pause
exit /b

:PUSH_EXISTING
echo.
set /p repourl="Cole a URL do seu repositorio no GitHub (ex: https://github.com/seu-user/MarcaRemoveIA.git): "
git remote remove origin >nul 2>&1
git remote add origin %repourl%
git branch -M main
git push -u origin main
echo.
pause
exit /b
