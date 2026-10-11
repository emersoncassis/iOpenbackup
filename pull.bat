@echo off
setlocal enabledelayedexpansion
title iOpenbackup - Pre-download de Imagens Docker
echo ================================================================
echo   iOpenbackup - Pre-download Sequencial de Imagens Docker
echo ================================================================

set IMAGES=mandarons/icloud-drive:latest dockurr/samba:latest docker.io/valkey/valkey:9@sha256:c123e3715db63d06d4ad6964884037aa0d5d4d703939b9929954112889708e1d ghcr.io/immich-app/postgres:14-vectorchord0.4.3-pgvectors0.2.0@sha256:bcf63357191b76a916ae5eb93464d65c07511da41e3bf7a8416db519b40b1c23 ghcr.io/immich-app/immich-server:release ghcr.io/immich-app/immich-machine-learning:release

for %%i in (%IMAGES%) do (
    echo.
    echo [*] Baixando: %%i...
    docker pull %%i
)

echo.
echo ================================================================
echo [OK] Todas as imagens foram baixadas para o cache do Docker!
echo ================================================================
