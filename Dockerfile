FROM node:20-alpine

WORKDIR /app

# Instalar dependências de produção primeiro (cache layer)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copiar código fonte (exceto uploads/ e data/ — vêm de volumes)
COPY server.js add-to-schedule.js publish.js ./
COPY public/ ./public/

# Criar diretórios de volume com permissão correta
RUN mkdir -p /app/data /app/uploads

# Declarar volumes persistentes
VOLUME ["/app/data", "/app/uploads"]

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001

CMD ["node", "server.js"]
