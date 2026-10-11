#!/usr/bin/env bash
# ==============================================================================
#  iOpenbackup - 1-Click Deployment Playbook
#  Idealizado por Emerson Carvalho (@emersoncassis)
#  Suporte: Ubuntu / Debian / CentOS / Rocky / AlmaLinux / Hostinger VPS
# ==============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m' # No Color

clear

echo -e "${CYAN}${BOLD}"
echo "  ================================================================"
echo "          iOpenbackup - Automação de Instalação (1-Click)"
echo "            Backup Automatizado e Privado de iPhones com IA"
echo "  ================================================================"
echo -e "${NC}"

# 1. Verificar privilégios de root
if [ "$EUID" -ne 0 ]; then
  echo -e "${YELLOW}[!] Recomendamos rodar como root ou com sudo para instalar os pacotes.${NC}"
fi

# Detectar IP Público / Local
SERVER_IP=$(curl -s -4 ifconfig.me || curl -s -4 icanhazip.com || hostname -I | awk '{print $1}')
echo -e "${BLUE}[*] IP detectado do servidor:${NC} ${BOLD}${SERVER_IP}${NC}"

# 2. Instalar dependências essenciais
echo -e "\n${BLUE}[1/5] Verificando dependências básicas (curl, git)...${NC}"
if command -v apt-get &> /dev/null; then
  apt-get update -qq && apt-get install -y -qq curl git > /dev/null 2>&1
elif command -v dnf &> /dev/null; then
  dnf install -y curl git > /dev/null 2>&1
fi
echo -e "${GREEN}[✓] Dependências básicas prontas!${NC}"

# 3. Verificar / Instalar Docker & Docker Compose
echo -e "\n${BLUE}[2/5] Verificando Docker e Docker Compose...${NC}"
if ! command -v docker &> /dev/null; then
  echo -e "${YELLOW}[*] Docker não encontrado. Instalando automaticamente via get.docker.com...${NC}"
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
  echo -e "${GREEN}[✓] Docker instalado com sucesso!${NC}"
else
  echo -e "${GREEN}[✓] Docker já está instalado: $(docker --version)${NC}"
fi

# Otimizar DNS e conexões simultâneas do Docker para evitar timeouts
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

# 4. Verificar / Instalar Node.js para o Dashboard
echo -e "\n${BLUE}[3/5] Verificando Node.js para o painel central...${NC}"
if ! command -v node &> /dev/null; then
  echo -e "${YELLOW}[*] Node.js não encontrado. Instalando Node.js LTS...${NC}"
  if command -v apt-get &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
    apt-get install -y -qq nodejs > /dev/null 2>&1
  elif command -v dnf &> /dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
    dnf install -y nodejs > /dev/null 2>&1
  fi
  echo -e "${GREEN}[✓] Node.js instalado com sucesso: $(node --version)${NC}"
else
  echo -e "${GREEN}[✓] Node.js já está instalado: $(node --version)${NC}"
fi

# 5. Preparar arquivos de configuração
echo -e "\n${BLUE}[4/5] Preparando arquivos de configuração...${NC}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -f "config/config.yaml" ] && [ -f "config/config.example.yaml" ]; then
  cp "config/config.example.yaml" "config/config.yaml"
  echo -e "${GREEN}[✓] Criado config/config.yaml a partir do exemplo.${NC}"
fi

mkdir -p dashboard/data
if [ ! -f "dashboard/data/users.json" ]; then
  echo "[]" > dashboard/data/users.json
fi

# 6. Pre-download sequencial e seguro de imagens
echo -e "\n${BLUE}[5/5] Baixando imagens Docker sequencialmente para garantir estabilidade...${NC}"
IMAGES=(
  "mandarons/icloud-drive:latest"
  "dockurr/samba:latest"
  "docker.io/valkey/valkey:9@sha256:c123e3715db63d06d4ad6964884037aa0d5d4d703939b9929954112889708e1d"
  "ghcr.io/immich-app/postgres:14-vectorchord0.4.3-pgvectors0.2.0@sha256:bcf63357191b76a916ae5eb93464d65c07511da41e3bf7a8416db519b40b1c23"
  "ghcr.io/immich-app/immich-server:release"
  "ghcr.io/immich-app/immich-machine-learning:release"
)
for img in "${IMAGES[@]}"; do
  echo -e "${CYAN}[*] Verificando: ${img}...${NC}"
  docker pull "$img" || true
done

echo -e "\n${BLUE}[*] Iniciando containers Docker (iCloud, Immich AI, Samba)...${NC}"
docker compose up -d

# 7. Configurar serviço Systemd para o Dashboard (Reinicia automaticamente no boot)
echo -e "\n${BLUE}[*] Configurando inicialização automática do Dashboard (Systemd)...${NC}"
SERVICE_FILE="/etc/systemd/system/iopenbackup-dashboard.service"
cat << EOF > "$SERVICE_FILE"
[Unit]
Description=iOpenbackup Dashboard & Auth Proxy
After=network.target docker.service

[Service]
Type=simple
User=root
WorkingDirectory=$SCRIPT_DIR
ExecStart=$(which node) $SCRIPT_DIR/dashboard/server.js
Restart=always
RestartSec=5
Environment=PORT=8000
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now iopenbackup-dashboard.service
echo -e "${GREEN}[✓] Serviço do Dashboard ativo e configurado para iniciar com o servidor!${NC}"

# ==============================================================================
#  RESUMO FINAL & INSTRUÇÕES
# ==============================================================================
echo -e "\n${GREEN}${BOLD}================================================================${NC}"
echo -e "${GREEN}${BOLD}     [OK] INSTALAÇÃO DO iOpenbackup CONCLUÍDA COM SUCESSO!     ${NC}"
echo -e "${GREEN}${BOLD}================================================================${NC}"
echo -e "\n${BOLD}Acesse os serviços pelo navegador ou iPhone:${NC}"
echo -e "  [-] ${CYAN}Dashboard Central:${NC}  http://${SERVER_IP}:8000"
echo -e "  [-] ${CYAN}iCloud 2FA Proxy:${NC}   http://${SERVER_IP}:8000/icloud-proxy/"
echo -e "  [-] ${CYAN}Immich Photos AI:${NC}   http://${SERVER_IP}:2283"
echo -e "  [-] ${CYAN}Samba SMB (iPhone):${NC} smb://${SERVER_IP}:4445"
echo -e "\n${YELLOW}[*] No primeiro acesso em http://${SERVER_IP}:8000, defina sua Senha Mestra.${NC}"
echo -e "${CYAN}================================================================${NC}\n"
