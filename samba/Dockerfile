FROM alpine:3.19

# Instala samba e shadow para gerenciamento de usuarios
RUN apk add --no-cache samba shadow

ENV USER=backupuser \
    PASS=backup123 \
    NAME=iCloud-Backup \
    RW=true

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 445

ENTRYPOINT ["/entrypoint.sh"]
