FROM node:20-alpine

# Define o diretório de trabalho
WORKDIR /app

# Instala dependências do sistema necessárias
RUN apk add --no-cache bash postgresql-client openssl

# Copia os arquivos de dependência
COPY package*.json ./
COPY prisma ./prisma/

# Instala TODAS as dependências
RUN npm install

# Gera o cliente do Prisma
RUN npx prisma generate

# Copia o restante do código
COPY . .

# Copia e torna executável o script wait-for-it
COPY wait-for-it.sh /usr/local/bin/wait-for-it.sh
RUN chmod +x /usr/local/bin/wait-for-it.sh

# Expõe as portas
EXPOSE 3333
EXPOSE 5555

# Comando para iniciar a aplicação
CMD ["bash", "/usr/local/bin/wait-for-it.sh", "db:5432", "--", "sh", "-c", "npx prisma migrate dev --name auto_migration --skip-generate || npx prisma migrate deploy && npx prisma db seed && npm run start:dev"]