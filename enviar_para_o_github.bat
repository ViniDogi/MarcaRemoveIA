@echo off
chcp 65001 >nul
title Enviar MarcaRemoveIA para o GitHub
cd /d "%~dp0"

echo ============================================================
echo   🚀 Enviando MarcaRemoveIA para o GitHub
echo   Destino: https://github.com/ViniDogi/MarcaRemoveIA.git
echo ============================================================
echo.

git push -u origin main

if %errorlevel% equ 0 (
    echo.
    echo ============================================================
    echo   ✅ [SUCESSO] Código e PATCHNOTES enviados com sucesso!
    echo ============================================================
) else (
    echo.
    echo [!] Caso tenha solicitado login, confirme a autorização e tente novamente.
)
echo.
pause
