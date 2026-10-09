#!/bin/sh
# Reusable local demo. Does not read .env or use production volumes.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

compose() { docker compose --env-file .env.demo -f docker-compose.demo.yml "$@"; }

case "${1:-help}" in
  init)
    if [ -e .env.demo ]; then
      echo '.env.demo already exists; settings and keys kept.'
      exit 0
    fi
    demo_host=${2:-127.0.0.1}
    # Accept only loopback/private IPv4; no public address or shell/env syntax.
    if ! awk -v ip="$demo_host" 'BEGIN {
      n=split(ip,a,"."); if(n!=4) exit 1;
      for(i=1;i<=4;i++) if(a[i]!~/^[0-9]+$/ || a[i]>255 || (length(a[i])>1 && substr(a[i],1,1)=="0")) exit 1;
      exit !(a[1]==127 || a[1]==10 || (a[1]==192 && a[2]==168) || (a[1]==172 && a[2]>=16 && a[2]<=31));
    }'; then
      echo 'Use a loopback or private IPv4 address, e.g. 127.0.0.1 or 192.168.1.10.' >&2
      exit 1
    fi
    command -v openssl >/dev/null
    umask 077
    auth_secret=$(openssl rand -hex 32)
    owner_password=$(openssl rand -hex 24)
    app_password=$(openssl rand -hex 24)
    config_key=$(openssl rand -base64 32)
    cat > .env.demo <<EOF
# Generated for local demo only. Keep out of git; never use real VPN configs.
DEMO_HOST=$demo_host
BETTER_AUTH_URL=https://$demo_host:8443
BETTER_AUTH_SECRET=$auth_secret
POSTGRES_PASSWORD=$owner_password
APP_DB_PASSWORD=$app_password
CONFIG_ENC_KEYS=demo:$config_key
CONFIG_ENC_ACTIVE_KEY_ID=demo
EOF
    echo "Demo initialized: https://$demo_host:8443 — run ./deploy/demo.sh start"
    ;;
  start)
    test -f .env.demo || { echo 'Run ./deploy/demo.sh init first.' >&2; exit 1; }
    compose build
    compose up -d --wait --wait-timeout 240
    sed -n 's/^BETTER_AUTH_URL=/Demo URL: /p' .env.demo
    ;;
  stop) compose stop ;;
  status) compose ps -a ;;
  logs) compose logs --tail=100 -f app ;;
  seed)
    compose run --rm --no-deps init node node_modules/tsx/dist/cli.mjs scripts/seed.mts
    ;;
  *)
    echo 'Usage: ./deploy/demo.sh init [private IPv4] | start | stop | status | logs | seed'
    ;;
esac
