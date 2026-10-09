#!/bin/sh
# Resets the DEV database to the seed state before a smoke run (the flows
# change data and remember the UI language). Never point this at production.
set -eu
cd "$(dirname "$0")/.."
docker compose --env-file .env.local -f docker-compose.yml exec -T db psql -U portal -d portal -qc \
  'truncate vpn_config_versions, vpn_configs, owner_aliases, quarantine_items, rate_limits, session cascade; update "user" set locale = null'
npm run -s db:seed
