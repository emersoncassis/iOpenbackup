#!/usr/bin/env bash
# ==============================================================================
# iOpenbackup - Definir Interface de Rede Cabeada (Ethernet) como Padrao
# Autor: Emerson Carvalho (@emersoncassis)
# ==============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${CYAN}================================================================${NC}"
echo -e "${CYAN}  iOpenbackup - Configuracao de Rede: Cabo Ethernet como Padrao ${NC}"
echo -e "${CYAN}================================================================${NC}"

if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}[X] Execute este script como root ou com sudo: sudo bash $0${NC}"
  exit 1
fi

# 1. Detectar interfaces de rede
ETH_IFACE=$(ip -o link show | awk -F': ' '{print $2}' | grep -E '^(eth0|end0|enp)' | head -n 1 || true)
WLAN_IFACE=$(ip -o link show | awk -F': ' '{print $2}' | grep -E '^(wlan0|wlp)' | head -n 1 || true)

if [ -z "$ETH_IFACE" ]; then
  echo -e "${RED}[X] Nenhuma interface cabeada (eth0/end0) detectada no sistema.${NC}"
  exit 1
fi

echo -e "${BLUE}[*] Interface cabeada detectada:${NC} ${BOLD}${ETH_IFACE}${NC}"
if [ -n "$WLAN_IFACE" ]; then
  echo -e "${BLUE}[*] Interface Wi-Fi detectada:${NC} ${BOLD}${WLAN_IFACE}${NC}"
fi

# 2. Subir a interface cabeada
echo -e "\n${BLUE}[1/4] Ativando interface cabeada ${ETH_IFACE}...${NC}"
ip link set dev "$ETH_IFACE" up 2>/dev/null || true

# 3. Detectar se o sistema usa NetworkManager (Raspberry Pi OS Bookworm) ou dhcpcd (Bullseye)
if command -v nmcli &>/dev/null && systemctl is-active --quiet NetworkManager; then
  echo -e "${BLUE}[2/4] Sistema de rede detectado: NetworkManager (Debian 12 / Bookworm)${NC}"

  # Obter ou criar conexao cabeada
  ETH_CONN=$(nmcli -t -f NAME,DEVICE connection show | grep ":${ETH_IFACE}$" | cut -d: -f1 | head -n 1 || true)
  if [ -z "$ETH_CONN" ]; then
    ETH_CONN="Cabo-${ETH_IFACE}"
    nmcli connection add type ethernet ifname "$ETH_IFACE" con-name "$ETH_CONN" 2>/dev/null || true
  fi

  echo -e "${BLUE}[*] Configurando prioridade da conexao cabeada (metric 100)...${NC}"
  nmcli connection modify "$ETH_CONN" ipv4.route-metric 100 2>/dev/null || true
  nmcli connection modify "$ETH_CONN" ipv6.route-metric 100 2>/dev/null || true
  nmcli connection modify "$ETH_CONN" connection.autoconnect yes 2>/dev/null || true
  nmcli connection modify "$ETH_CONN" connection.autoconnect-priority 100 2>/dev/null || true

  # Rebaixar prioridade do Wi-Fi se existir
  if [ -n "$WLAN_IFACE" ]; then
    WLAN_CONN=$(nmcli -t -f NAME,DEVICE connection show | grep ":${WLAN_IFACE}$" | cut -d: -f1 | head -n 1 || true)
    if [ -n "$WLAN_CONN" ]; then
      echo -e "${BLUE}[*] Ajustando conexao Wi-Fi como fallback (metric 600)...${NC}"
      nmcli connection modify "$WLAN_CONN" ipv4.route-metric 600 2>/dev/null || true
      nmcli connection modify "$WLAN_CONN" ipv6.route-metric 600 2>/dev/null || true
      nmcli connection modify "$WLAN_CONN" connection.autoconnect-priority 50 2>/dev/null || true
    fi
  fi

  echo -e "${BLUE}[*] Aplicando configuracoes no NetworkManager...${NC}"
  nmcli connection up "$ETH_CONN" 2>/dev/null || true

elif [ -f "/etc/dhcpcd.conf" ]; then
  echo -e "${BLUE}[2/4] Sistema de rede detectado: dhcpcd (Debian 11 / Bullseye)${NC}"

  # Remover entradas antigas se ja configuradas
  sed -i '/# iOpenbackup Network Priorities/,+8d' /etc/dhcpcd.conf 2>/dev/null || true

  cat << EOF >> /etc/dhcpcd.conf

# iOpenbackup Network Priorities
interface ${ETH_IFACE}
metric 100

interface ${WLAN_IFACE}
metric 600
EOF

  echo -e "${BLUE}[*] Reiniciando servico dhcpcd...${NC}"
  systemctl restart dhcpcd 2>/dev/null || true
else
  echo -e "${YELLOW}[!] Sistema generico de rede. Solicitando DHCP direto na interface ${ETH_IFACE}...${NC}"
  dhclient -v "$ETH_IFACE" 2>/dev/null || true
fi

# 4. Aguardar obtencao de IP via cabo
echo -e "\n${BLUE}[3/4] Aguardando atribuicao de endereco IP na interface cabeada...${NC}"
sleep 3

ETH_IP=$(ip -4 addr show dev "$ETH_IFACE" | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -n 1 || true)
WLAN_IP=$(ip -4 addr show dev "$WLAN_IFACE" 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -n 1 || true)

# 5. Exibir resultado e rotas ativas
echo -e "\n${GREEN}[4/4] Verificacao concluida!${NC}"
echo -e "${CYAN}----------------------------------------------------------------${NC}"
if [ -n "$ETH_IP" ]; then
  echo -e "${GREEN}[OK] IP da Interface Cabeada (${ETH_IFACE}):${NC} ${BOLD}${ETH_IP}${NC}"
else
  echo -e "${YELLOW}[!] Cabo conectado, mas o roteador ainda nao atribuiu IP. Verifique o cabo ou reinicie o modem.${NC}"
fi

if [ -n "$WLAN_IP" ]; then
  echo -e "${BLUE}[*] IP da Interface Wi-Fi (${WLAN_IFACE}):${NC} ${WLAN_IP} (ativa como contingencia)"
fi

echo -e "\n${BLUE}[*] Rota padrao ativa (Gateway padrao):${NC}"
ip route show default || true

echo -e "${CYAN}----------------------------------------------------------------${NC}"
echo -e "${GREEN}[OK] A interface cabeada (${ETH_IFACE}) agora eh a rota padrao do Raspberry Pi!${NC}"
if [ -n "$ETH_IP" ]; then
  echo -e "${GREEN}[*] Acesse o Dokploy e o iOpenbackup atraves do novo IP: http://${ETH_IP}:8000${NC}"
fi
echo -e "${CYAN}================================================================${NC}\n"
