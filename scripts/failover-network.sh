#!/usr/bin/env bash
# ==============================================================================
# iOpenbackup - Wrapper para scripts/wifi-failover.sh
# ==============================================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "${SCRIPT_DIR}/wifi-failover.sh" "$@"
