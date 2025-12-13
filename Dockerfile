FROM node:20-alpine

WORKDIR /app

# Install system dependencies
RUN apk add --no-cache bash openssl libc6-compat wget postgresql-client

# Copy package files and prisma schema
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm install

# Generate Prisma client
RUN npx prisma generate

# Copy application code
COPY . .

# BUILD TypeScript to dist/
RUN npm run build

# Copy wait-for-it script
COPY wait-for-it.sh /usr/local/bin/wait-for-it.sh
RUN chmod +x /usr/local/bin/wait-for-it.sh

# Expose ports
EXPOSE 3333 5555

# Default command
CMD ["npm", "run", "start:dev"]