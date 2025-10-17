FROM node:18-alpine

# Define o diretório de trabalho
WORKDIR /app

# Instala dependências do sistema
RUN apk add --no-cache bash postgresql-client

# Copia os arquivos de dependência
COPY package*.json ./

# Instala TODAS as dependências (dev e production)
RUN npm install

# Copia o restante do seu projeto
COPY . .

# Remove qualquer cliente Prisma gerado localmente
RUN rm -rf src/generated

# Gera o cliente do Prisma no ambiente Linux
RUN npx prisma generate

# Copia e torna executável o script wait-for-it
COPY ./wait-for-it.sh /wait-for-it.sh
RUN chmod +x /wait-for-it.sh

# Expõe a porta da sua API
EXPOSE 3333

# Comando para iniciar sua aplicação com migração automática
CMD ["/wait-for-it.sh", "db:5432", "--", "sh", "-c", "npx prisma migrate deploy && npx prisma db seed && npm run start:dev"]