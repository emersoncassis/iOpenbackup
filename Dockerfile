FROM node:20-alpine

# Instala docker-cli para que o iOpDash possa orquestrar containers via docker.sock
RUN apk add --no-cache docker-cli

WORKDIR /app

# Copia dependencias e arquivos do projeto
COPY package*.json ./
COPY config ./config
COPY dashboard ./dashboard

WORKDIR /app/dashboard

EXPOSE 8000

ENV PORT=8000 \
    NODE_ENV=production \
    ICLOUD_HOST=icloud \
    ICLOUD_PORT=8080 \
    CONFIG_FILE_PATH=/config/config.yaml

CMD ["node", "server.js"]
