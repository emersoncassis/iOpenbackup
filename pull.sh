#!/usr/bin/env bash
# ==============================================================================
# iOpenbackup - Pre-download Sequencial e Resiliente de Imagens Docker
# Evita saturacao de rede, timeouts de DNS e TLS handshake timeouts
# ==============================================================================
set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${CYAN}================================================================${NC}"
echo -e "${CYAN}  iOpenbackup - Pre-download Seguro de Imagens Docker (1 por 1) ${NC}"
echo -e "${CYAN}================================================================${NC}"

# Otimizar DNS se /etc/docker/daemon.json puder ser configurado
if [ -w "/etc/docker" ] && [ ! -f "/etc/docker/daemon.json" ]; then
  echo -e "${BLUE}[*] Otimizando /etc/docker/daemon.json com DNS 1.1.1.1 e 8.8.8.8...${NC}"
  cat << 'EOF' > /etc/docker/daemon.json
{
  "max-concurrent-downloads": 2,
  "dns": ["1.1.1.1", "8.8.8.8"]
}
EOF
  systemctl restart docker 2>/dev/null || true
fi

IMAGES=(
  "mandarons/icloud-drive:latest"
  "docker.io/valkey/valkey:9@sha256:c123e3715db63d06d4ad6964884037aa0d5d4d703939b9929954112889708e1d"
  "ghcr.io/immich-app/postgres:14-vectorchord0.4.3-pgvectors0.2.0@sha256:bcf63357191b76a916ae5eb93464d65c07511da41e3bf7a8416db519b40b1c23"
  "ghcr.io/immich-app/immich-server:release"
)

TOTAL=${#IMAGES[@]}
CURRENT=0

for img in "${IMAGES[@]}"; do
  CURRENT=$((CURRENT + 1))
  echo -e "\n${BLUE}[$CURRENT/$TOTAL] Baixando: ${CYAN}${img}${NC}..."
  
  TRIES=0
  SUCCESS=false
  while [ $TRIES -lt 3 ]; do
    TRIES=$((TRIES + 1))
    if docker pull "$img"; then
      SUCCESS=true
      echo -e "${GREEN}[OK] Concluido: ${img}${NC}"
      break
    else
      echo -e "${YELLOW}[!] Tentativa $TRIES falhou. Aguardando 3s antes de tentar novamente...${NC}"
      sleep 3
    fi
  done

  if [ "$SUCCESS" = false ]; then
    echo -e "${RED}[X] Erro critico ao baixar ${img}. Continuando proximas imagens...${NC}"
  fi
done

echo -e "\n${GREEN}================================================================${NC}"
echo -e "${GREEN}[OK] Pre-download de imagens finalizado!${NC}"
echo -e "${GREEN}================================================================${NC}\n"
