#!/bin/sh
# Nightly PostgreSQL backup for the portal. Run from cron on the server:
#   15 2 * * * /srv/portal/deploy/backup.sh >> /var/log/portal-backup.log 2>&1
#
# Writes a compressed custom-format dump to $BACKUP_DIR and keeps $KEEP_DAYS
# days. Config contents inside the dump stay encrypted — restoring them needs
# CONFIG_ENC_KEYS, which is backed up separately (see docs/DEPLOY.md).
set -eu

PORTAL_DIR=${PORTAL_DIR:-/srv/portal}
BACKUP_DIR=${BACKUP_DIR:-/srv/portal-backups}
KEEP_DAYS=${KEEP_DAYS:-14}

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
stamp=$(date +%Y%m%d-%H%M%S)
target="$BACKUP_DIR/portal-$stamp.dump"

cd "$PORTAL_DIR"
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U portal -d portal --format=custom --compress=9 > "$target.part"
mv "$target.part" "$target"
chmod 600 "$target"

# Sanity check: the dump must be readable by pg_restore.
docker compose -f docker-compose.prod.yml exec -T db pg_restore --list < "$target" > /dev/null

find "$BACKUP_DIR" -name 'portal-*.dump' -mtime +"$KEEP_DAYS" -delete
echo "$(date -Is) backup ok: $target ($(du -h "$target" | cut -f1))"
