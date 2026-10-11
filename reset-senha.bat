@echo off
title iOpenbackup - Reset de Senha do Administrador
echo ====================================================
echo        iOpenbackup - RESET DE SENHA MESTRA
echo ====================================================
echo.

if exist "dashboard\data\auth.json" (
    del /f /q "dashboard\data\auth.json"
    echo [SUCESSO] Credenciais do administrador resetadas com sucesso!
) else (
    echo [INFO] O sistema ja esta sem senha configurada (modo primeiro acesso).
)

echo.
echo Abra o navegador em: http://localhost:8000
echo A tela de "Configuracao do Primeiro Acesso" aparecera
echo para voce definir o novo usuario e senha mestre.
echo.
pause
