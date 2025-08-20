#!/bin/bash

source ~/.bashrc

git pull origin main

npm ci

npm run build

npx prisma migrate deploy

npx prisma db seed

env ASDF_NODEJS_VERSION=$NODE_VERSION_PM2 pm2 reload ecosystem.config.js

env ASDF_NODEJS_VERSION=$NODE_VERSION_PM2 pm2 reload ecosystem-dev.config.js