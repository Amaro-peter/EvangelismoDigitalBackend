#!/usr/bin/env bash
set -e

set -a
source .env
set +a

docker compose -f docker-compose.prod.yml up -d --build
