#!/bin/sh
set -e

USER="${USER:-backupuser}"
PASS="${PASS:-backup123}"
NAME="${NAME:-iCloud-Backup}"

# Cria usuario do sistema caso nao exista
if ! id "$USER" >/dev/null 2>&1; then
  useradd -M -s /sbin/nologin "$USER"
fi

# Define senha no Samba
printf "%s\n%s\n" "$PASS" "$PASS" | smbpasswd -s -a "$USER"
smbpasswd -e "$USER"

# Garante pasta de compartilhamento
mkdir -p /shared
chown -R "$USER:$USER" /shared || true
chmod 777 /shared || true

# Configura smb.conf otimizado para iOS Files
cat <<EOF > /etc/samba/smb.conf
[global]
  workgroup = WORKGROUP
  server string = iOpenbackup Samba
  security = user
  map to guest = Bad User
  dns proxy = no
  wide links = yes
  unix extensions = no
  ntlm auth = yes
  min protocol = SMB2
  load printers = no
  printing = bsd
  printcap name = /dev/null
  disable spoolss = yes

[$NAME]
  path = /shared
  comment = iPhone Backup Share
  browseable = yes
  writable = yes
  read only = no
  guest ok = no
  valid users = $USER
  create mask = 0777
  directory mask = 0777
  force user = $USER
EOF

echo "[OK] Samba iniciado com sucesso para o usuario: $USER"
exec smbd -F --no-process-group < /dev/null
