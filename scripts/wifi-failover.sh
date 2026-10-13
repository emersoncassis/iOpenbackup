#!/usr/bin/env bash
# ==============================================================================
# iOpenbackup - Failover Inteligente: Wi-Fi Desabilitado (Ativa Apenas se Cabo Cair)
# Autor: Emerson Carvalho (@emersoncassis)
#
# Comportamento:
# - Cabo Ethernet eh a conexao principal (maxima velocidade e estabilidade).
# - O Wi-Fi permanece 100% DESABILITADO enquanto o cabo estiver conectado e com rede.
# - Se o cabo for desconectado ou a rede cabeada cair, o Wi-Fi eh ATIVADO automaticamente.
# - Quando o cabo retorna e a rede estabiliza, o Wi-Fi eh DESLIGADO novamente.
# ==============================================================================

set -u

# Cores para saida no terminal
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

CHECK_INTERVAL=5
FAIL_THRESHOLD=2     # 2 falhas consecutivas (10s) para ligar o Wi-Fi
RESTORE_THRESHOLD=2  # 2 sucessos consecutivos (10s) para desligar o Wi-Fi

# Detectar interface cabeada (eth0, end0, enp3s0, etc)
detect_eth() {
  local iface=""
  iface=$(ip -o link show 2>/dev/null | awk -F': ' '{print $2}' | grep -E '^(eth|end|enp|eno|ens)' | head -n 1 || true)
  if [ -z "$iface" ]; then
    iface="eth0"
  fi
  echo "$iface"
}

# Detectar interface Wi-Fi (wlan0, wlp2s0, etc)
detect_wlan() {
  local iface=""
  iface=$(ip -o link show 2>/dev/null | awk -F': ' '{print $2}' | grep -E '^(wlan|wlp|wls)' | head -n 1 || true)
  if [ -z "$iface" ]; then
    iface="wlan0"
  fi
  echo "$iface"
}

ETH_IFACE="${ETH_IFACE:-$(detect_eth)}"
WLAN_IFACE="${WLAN_IFACE:-$(detect_wlan)}"
TEST_HOSTS=("1.1.1.1" "8.8.8.8")

log() {
  local msg="[$(date '+%Y-%m-%d %H:%M:%S')] [iOpenbackup-Failover] $1"
  echo -e "$msg"
  if command -v logger >/dev/null 2>&1; then
    logger -t "iopenbackup-failover" "$1"
  fi
}

# Verifica se o Wi-Fi esta ativo no momento
is_wifi_on() {
  # 1. Checagem via NetworkManager se disponivel
  if command -v nmcli >/dev/null 2>&1 && systemctl is-active --quiet NetworkManager 2>/dev/null; then
    if nmcli radio wifi 2>/dev/null | grep -qi "enabled"; then
      return 0
    fi
  fi

  # 2. Checagem via rfkill
  if command -v rfkill >/dev/null 2>&1; then
    if rfkill list wifi 2>/dev/null | grep -i "Soft blocked: yes" >/dev/null 2>&1; then
      return 1
    fi
  fi

  # 3. Checagem de estado da interface
  local state
  state=$(cat "/sys/class/net/$WLAN_IFACE/operstate" 2>/dev/null || echo "down")
  if [ "$state" = "up" ]; then
    return 0
  fi

  return 1
}

# Desativa completamente o Wi-Fi
turn_wifi_off() {
  log "${BLUE}[*] Desativando Wi-Fi (${WLAN_IFACE})... Cabo cabeado está ativo.${NC}"

  # NetworkManager
  if command -v nmcli >/dev/null 2>&1; then
    nmcli radio wifi off 2>/dev/null || true
    nmcli dev disconnect "$WLAN_IFACE" 2>/dev/null || true
  fi

  # rfkill (bloqueio de radio)
  if command -v rfkill >/dev/null 2>&1; then
    rfkill block wifi 2>/dev/null || true
  fi

  # Descer interface diretamente
  ip link set dev "$WLAN_IFACE" down 2>/dev/null || true

  log "${GREEN}[OK] Wi-Fi desabilitado com sucesso. Tráfego 100% no cabo Ethernet (${ETH_IFACE}).${NC}"
}

# Ativa e conecta o Wi-Fi
turn_wifi_on() {
  log "${YELLOW}[!] ATIVANDO Wi-Fi de contingência (${WLAN_IFACE})... O cabo Ethernet perdeu conexão!${NC}"

  # rfkill desbloqueio
  if command -v rfkill >/dev/null 2>&1; then
    rfkill unblock wifi 2>/dev/null || true
  fi

  # Subir interface
  ip link set dev "$WLAN_IFACE" up 2>/dev/null || true

  # NetworkManager ligar radio e conectar
  if command -v nmcli >/dev/null 2>&1; then
    nmcli radio wifi on 2>/dev/null || true
    nmcli dev connect "$WLAN_IFACE" 2>/dev/null || true
  fi

  log "${GREEN}[OK] Wi-Fi ativado para manter o servidor acessível!${NC}"
}

# Testa a saude da conexao cabeada
check_ethernet() {
  # 1. Checa presenca fisica do link (cabo conectado na placa e no roteador)
  local carrier_file="/sys/class/net/$ETH_IFACE/carrier"
  if [ ! -r "$carrier_file" ] || [ "$(cat "$carrier_file" 2>/dev/null)" != "1" ]; then
    return 1
  fi

  # 2. Descobrir gateway local da interface cabeada
  local gw
  gw=$(ip route show dev "$ETH_IFACE" 2>/dev/null | grep -E '^default ' | awk '{print $3}' | head -n 1 || true)
  if [ -n "$gw" ]; then
    if ping -c 1 -W 2 -I "$ETH_IFACE" "$gw" >/dev/null 2>&1; then
      return 0
    fi
  fi

  # 3. Testar ping para hosts publicos de teste
  for host in "${TEST_HOSTS[@]}"; do
    if ping -c 1 -W 2 -I "$ETH_IFACE" "$host" >/dev/null 2>&1; then
      return 0
    fi
  done

  # Se tem link fisico (carrier=1) e tem IP atribuido, considera vivo mesmo se ICMP externo estiver bloqueado
  local ip_addr
  ip_addr=$(ip -4 addr show dev "$ETH_IFACE" 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -n 1 || true)
  if [ -n "$ip_addr" ]; then
    return 0
  fi

  return 1
}

# Loop principal de monitoramento
daemon_loop() {
  log "${CYAN}================================================================${NC}"
  log "${CYAN}  iOpenbackup - Monitor de Failover de Rede Iniciado             ${NC}"
  log "${CYAN}  Interface Cabo: ${BOLD}${ETH_IFACE}${NC}${CYAN} | Interface Wi-Fi: ${BOLD}${WLAN_IFACE}${NC}"
  log "${CYAN}================================================================${NC}"

  local fail_count=0
  local success_count=0

  # Avaliacao inicial imediata
  if check_ethernet; then
    log "${GREEN}[Início] Conexão cabeada (${ETH_IFACE}) detectada online.${NC}"
    if is_wifi_on; then
      turn_wifi_off
    else
      log "${GREEN}[Início] Wi-Fi já está desabilitado como esperado.${NC}"
    fi
  else
    log "${YELLOW}[Início] Conexão cabeada não encontrada ou sem link. Garantindo Wi-Fi ligado...${NC}"
    if ! is_wifi_on; then
      turn_wifi_on
    fi
  fi

  while true; do
    if check_ethernet; then
      fail_count=0
      success_count=$((success_count + 1))

      if [ "$success_count" -ge "$RESTORE_THRESHOLD" ]; then
        if is_wifi_on; then
          log "${GREEN}[Link Estabilizado] Cabo Ethernet (${ETH_IFACE}) 100% ativo. Desligando Wi-Fi...${NC}"
          turn_wifi_off
        fi
      fi
    else
      success_count=0
      fail_count=$((fail_count + 1))

      if [ "$fail_count" -ge "$FAIL_THRESHOLD" ]; then
        if ! is_wifi_on; then
          log "${RED}[ALERTA] Falha na rede cabeada (${ETH_IFACE})! Ligando Wi-Fi de contingência...${NC}"
          turn_wifi_on
        fi
      fi
    fi

    sleep "$CHECK_INTERVAL"
  done
}

# Instalacao do servico systemd
install_service() {
  if [ "${EUID:-$(id -u)}" -ne 0 ]; then
    echo -e "${RED}[Erro] A instalacao requer privilegios de root. Execute: sudo bash $0 install${NC}"
    exit 1
  fi

  echo -e "${CYAN}[*] Instalando o script em /usr/local/bin/iopenbackup-wifi-failover...${NC}"
  cp "$0" /usr/local/bin/iopenbackup-wifi-failover
  chmod +x /usr/local/bin/iopenbackup-wifi-failover

  local service_file="/etc/systemd/system/iopenbackup-wifi-failover.service"
  echo -e "${CYAN}[*] Criando servico systemd em ${service_file}...${NC}"

  cat << EOF > "$service_file"
[Unit]
Description=iOpenbackup - Monitor de Failover Inteligente (Cabo Ethernet / Wi-Fi)
After=network.target network-online.target NetworkManager.service
Wants=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/iopenbackup-wifi-failover run
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable iopenbackup-wifi-failover.service
  systemctl restart iopenbackup-wifi-failover.service

  echo -e "\n${GREEN}[✓] Servico instalado e ativado com sucesso!${NC}"
  echo -e "${CYAN}Comandos uteis:${NC}"
  echo -e "  - Status:  ${BOLD}sudo systemctl status iopenbackup-wifi-failover${NC}"
  echo -e "  - Logs:    ${BOLD}sudo journalctl -u iopenbackup-wifi-failover -f${NC}"
  echo -e "  - Parar:   ${BOLD}sudo systemctl stop iopenbackup-wifi-failover${NC}"
  echo -e "  - Remover: ${BOLD}sudo bash $0 uninstall${NC}\n"
}

# Desinstalacao do servico systemd
uninstall_service() {
  if [ "${EUID:-$(id -u)}" -ne 0 ]; then
    echo -e "${RED}[Erro] A desinstalacao requer privilegios de root. Execute: sudo bash $0 uninstall${NC}"
    exit 1
  fi

  echo -e "${YELLOW}[*] Parando e removendo o servico iopenbackup-wifi-failover...${NC}"
  systemctl stop iopenbackup-wifi-failover.service 2>/dev/null || true
  systemctl disable iopenbackup-wifi-failover.service 2>/dev/null || true
  rm -f /etc/systemd/system/iopenbackup-wifi-failover.service
  rm -f /usr/local/bin/iopenbackup-wifi-failover
  systemctl daemon-reload

  # Deixar o Wi-Fi no estado ligado padrao para evitar perda de acesso
  if command -v nmcli >/dev/null 2>&1; then
    nmcli radio wifi on 2>/dev/null || true
  fi
  if command -v rfkill >/dev/null 2>&1; then
    rfkill unblock wifi 2>/dev/null || true
  fi

  echo -e "${GREEN}[✓] Servico desinstalado com sucesso. Wi-Fi reativado por seguranca.${NC}"
}

# Status atual das interfaces
show_status() {
  echo -e "${CYAN}================================================================${NC}"
  echo -e "${CYAN}  iOpenbackup - Status de Rede e Failover                        ${NC}"
  echo -e "${CYAN}================================================================${NC}"
  echo -e "${BOLD}Interface Cabeada:${NC} $ETH_IFACE"
  local eth_ip
  eth_ip=$(ip -4 addr show dev "$ETH_IFACE" 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -n 1 || echo "Sem IP")
  local carrier_file="/sys/class/net/$ETH_IFACE/carrier"
  local carrier_val
  carrier_val=$(cat "$carrier_file" 2>/dev/null || echo "0")
  if [ "$carrier_val" = "1" ]; then
    echo -e "  - Link físico: ${GREEN}Conectado (Carrier 1)${NC}"
  else
    echo -e "  - Link físico: ${RED}Desconectado (Carrier 0)${NC}"
  fi
  echo -e "  - IP: $eth_ip"

  echo -e "\n${BOLD}Interface Wi-Fi:${NC} $WLAN_IFACE"
  if is_wifi_on; then
    local wlan_ip
    wlan_ip=$(ip -4 addr show dev "$WLAN_IFACE" 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -n 1 || echo "Sem IP")
    echo -e "  - Estado: ${YELLOW}LIGADO (Ativo)${NC}"
    echo -e "  - IP: $wlan_ip"
  else
    echo -e "  - Estado: ${GREEN}DESABILITADO (Desligado economizando energia / sem conflito)${NC}"
  fi

  echo -e "\n${BOLD}Status do Serviço Systemd:${NC}"
  if systemctl is-active --quiet iopenbackup-wifi-failover.service 2>/dev/null; then
    echo -e "  ${GREEN}● Ativo e monitorando (running)${NC}"
  else
    echo -e "  ${YELLOW}○ Não está rodando como serviço (execute: sudo bash $0 install)${NC}"
  fi
  echo -e "${CYAN}================================================================${NC}\n"
}

# Menu de comandos
case "${1:-}" in
  install)
    install_service
    ;;
  uninstall|remove)
    uninstall_service
    ;;
  status)
    show_status
    ;;
  run|start|daemon)
    daemon_loop
    ;;
  *)
    echo -e "${CYAN}Uso:${NC} sudo bash $0 {install|uninstall|status|run}"
    echo -e ""
    echo -e "  ${BOLD}install${NC}    Instala como serviço permanente no systemd (inicia no boot)"
    echo -e "  ${BOLD}status${NC}     Verifica o estado atual do cabo, Wi-Fi e do serviço"
    echo -e "  ${BOLD}run${NC}        Executa diretamente em primeiro plano para testes"
    echo -e "  ${BOLD}uninstall${NC}  Remove o serviço systemd e restaura o Wi-Fi padrão"
    echo -e ""
    # Se chamado sem argumentos no terminal interativo, roda status por padrao
    show_status
    ;;
esac
