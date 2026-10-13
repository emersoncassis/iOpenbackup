#!/usr/bin/env bash
# ==============================================================================
# iOpenbackup - Dokploy Auto Deploy Script com Correcao de MTU e DNS
# ==============================================================================
set -e

# 1. Limpar entradas estaticas que possam ter sido injetadas
if [ -w "/etc/hosts" ]; then
  sed -i '/ghcr\.io/d;/pkg-containers/d;/registry-1\.docker\.io/d;/production\.cloudflare/d' /etc/hosts 2>/dev/null || true
fi

# 2. Configurar DNS rapido da Cloudflare
if [ -w "/etc/resolv.conf" ]; then
  echo -e "nameserver 1.1.1.1\nnameserver 1.0.0.1" > /etc/resolv.conf || true
fi

# 3. Corrigir MTU para 1420 (evita perda de pacotes TLS em redes com fibra/PPPoE)
for iface in $(ip -o link show | awk -F': ' '{print $2}' | grep -v 'lo'); do
  ip link set dev "$iface" mtu 1420 2>/dev/null || true
done
iptables -t mangle -A POSTROUTING -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || true

echo "[*] Subindo containers Docker via Compose (iOpDash Orquestrador, iCloud, Samba, Immich)..."
exec docker compose --env-file .env -f ./docker-compose.yml up -d --build --remove-orphans
