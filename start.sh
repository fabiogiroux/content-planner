#!/bin/bash
# Inicia o Instagram Scheduler

# Carrega o token do .env do projeto se existir
ENV_FILE="/root/assistente-pessoal/.env"
if [ -f "$ENV_FILE" ]; then
  export $(grep -v '^#' "$ENV_FILE" | grep 'INSTAGRAM_USER_TOKEN' | xargs)
fi

# Fallback: token pode ser passado direto como variável
# INSTAGRAM_USER_TOKEN="..." ./start.sh

cd /root/instagram-scheduler
PORT=3001 node server.js
