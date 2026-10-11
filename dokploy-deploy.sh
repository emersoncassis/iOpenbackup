#!/usr/bin/env bash
# ==============================================================================
# iOpenbackup - Dokploy Auto Deploy Script com Bypass Direto de DNS no Hosts
# Evita qualquer timeout de UDP na porta 53 associando os IPs diretamente
# ==============================================================================
set -e

echo "[*] Configurando resolucao direta de IPs em /etc/hosts (zero consultas DNS)..."
if [ -w "/etc/hosts" ]; then
  grep -q "ghcr.io" /etc/hosts || cat << 'EOF' >> /etc/hosts
140.82.112.33 github.com
140.82.114.34 api.github.com
4.228.31.152 ghcr.io
185.199.109.154 pkg-containers.githubusercontent.com
34.237.181.64 registry-1.docker.io
172.64.144.78 auth.docker.io
104.16.100.215 production.cloudflare.docker.com
EOF
fi

if [ -w "/etc/resolv.conf" ]; then
  echo -e "nameserver 1.1.1.1\nnameserver 8.8.8.8" > /etc/resolv.conf || true
fi

echo "[*] Subindo containers Docker via Compose..."
exec docker compose --env-file .env -f ./docker-compose.yml up -d --build --remove-orphans
