@echo off
setlocal enabledelayedexpansion
title iOpenbackup - Pre-download de Imagens Docker
echo ================================================================
echo   iOpenbackup - Pre-download Sequencial de Imagens Docker
echo ================================================================

set IMAGES=mandarons/icloud-drive:latest dockurr/samba:latest docker.io/valkey/valkey:8-alpine ghcr.io/immich-app/postgres:14-vectorchord0.4.3-pgvectors0.2.0 ghcr.io/immich-app/immich-server:release ghcr.io/immich-app/immich-machine-learning:release

for %%i in (%IMAGES%) do (
    echo.
    echo [*] Baixando: %%i...
    docker pull %%i
)

echo.
echo ================================================================
echo [OK] Todas as imagens foram baixadas para o cache do Docker!
echo ================================================================
