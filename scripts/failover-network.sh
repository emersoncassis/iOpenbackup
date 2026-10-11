#!/usr/bin/env bash
# ==============================================================================
# iOpenbackup - Servico de Failover Inteligente de Rede (Cabo eth0 / Wi-Fi wlan0)
# Autor: Emerson Carvalho (@emersoncassis)
#
# Comportamento:
# - Cabo eth0 eh a interface principal de alta velocidade para Dokploy e Docker.
# - O Wi-Fi permanece 100% desligado enquanto o cabo tiver internet.
# - Se o cabo for desconectado ou perder a conexao, o Wi-Fi sobe automaticamente.
# - Quando o cabo retorna, o Wi-Fi eh desligado novamente de forma transparente.
# ==============================================================================

ETH_IFACE="eth0"
WLAN_IFACE="wlan0"
TEST_TARGET="1.1.1.1"
GATEWAY="192.168.15.1"
CHECK_INTERVAL=5
FAIL_COUNT=0
SUCCESS_COUNT=0

echo "[Failover] Iniciando monitoramento de redundancia de rede..."

check_cable() {
  # 1. Checar link fisico (cabo plugado)
  if [ ! -r "/sys/class/net/$ETH_IFACE/carrier" ] || [ "$(cat /sys/class/net/$ETH_IFACE/carrier 2>/dev/null)" != "1" ]; then
    return 1
  fi
  # 2. Testar ping pelo cabo
  if ping -c 1 -W 2 -I "$ETH_IFACE" "$TEST_TARGET" >/dev/null 2>&1 || ping -c 1 -W 2 -I "$ETH_IFACE" "$GATEWAY" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

is_wifi_enabled() {
  nmcli radio wifi 2>/dev/null | grep -qi "enabled"
}

while true; do
  if check_cable; then
    FAIL_COUNT=0
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))

    # Apos 2 checagens consecutivas com sucesso (10s estaveis), desativa o Wi-Fi
    if [ "$SUCCESS_COUNT" -ge 2 ] && is_wifi_enabled; then
      echo "[Failover] Cabo de rede estavel com internet ativa. Desligando Wi-Fi..."
      nmcli radio wifi off 2>/dev/null || true
    fi
  else
    SUCCESS_COUNT=0
    FAIL_COUNT=$((FAIL_COUNT + 1))

    # Apos 2 falhas consecutivas, ativa o Wi-Fi imediatamente
    if [ "$FAIL_COUNT" -ge 2 ] && ! is_wifi_enabled; then
      echo "[Failover] ALERTA: Cabo de rede desconectado ou sem internet! Ativando Wi-Fi de contingencia..."
      nmcli radio wifi on 2>/dev/null || true
      nmcli dev connect "$WLAN_IFACE" 2>/dev/null || true
    fi
  fi

  sleep "$CHECK_INTERVAL"
done
