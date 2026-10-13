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

# Adiciona usuarios adicionais alinhados pelo modulo orquestrador iOpDash
EXTRA_USERS=""
if [ -f "/data/samba_users.conf" ]; then
  while IFS=: read -r extra_u extra_uid extra_grp extra_gid extra_pass extra_dir || [ -n "$extra_u" ]; do
    case "$extra_u" in
      \#*|"") continue ;;
    esac
    if [ -n "$extra_u" ] && [ "$extra_u" != "$USER" ]; then
      if ! id "$extra_u" >/dev/null 2>&1; then
        useradd -M -s /sbin/nologin "$extra_u" || true
      fi
      printf "%s\n%s\n" "$extra_pass" "$extra_pass" | smbpasswd -s -a "$extra_u"
      smbpasswd -e "$extra_u"
      EXTRA_USERS="$EXTRA_USERS $extra_u"
    fi
  done < /data/samba_users.conf
fi

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
  valid users = $USER $EXTRA_USERS
  create mask = 0777
  directory mask = 0777
  force user = $USER
EOF

echo "[OK] Samba iniciado com sucesso para o usuario: $USER"
exec smbd -F --no-process-group < /dev/null
