@echo off
title iOpenbackup Dashboard
echo ====================================================
echo Iniciando Stack Docker e Dashboard iOpenbackup...
echo ====================================================

docker compose up -d
echo Containers Docker iniciados!

echo Iniciando servidor Dashboard na porta 8000...
node dashboard/server.js
pause
