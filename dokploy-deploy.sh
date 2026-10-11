#!/usr/bin/env bash
# ==============================================================================
# iOpenbackup - Dokploy Auto Deploy Script com Correcao de DNS
# Substitui o DNS travado do roteador local (192.168.0.1) por Cloudflare e Google
# ==============================================================================
set -e

echo "[*] Aplicando DNS estavel (Cloudflare 1.1.1.1 e Google 8.8.8.8)..."
if [ -w "/etc/resolv.conf" ]; then
  echo -e "nameserver 1.1.1.1\nnameserver 8.8.8.8" > /etc/resolv.conf || true
elif command -v sudo &>/dev/null; then
  echo -e "nameserver 1.1.1.1\nnameserver 8.8.8.8" | sudo tee /etc/resolv.conf >/dev/null || true
fi

echo "[*] Subindo containers Docker via Compose..."
exec docker compose --env-file .env -f ./docker-compose.yml up -d --build --remove-orphans
