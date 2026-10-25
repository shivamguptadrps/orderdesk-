#!/bin/sh
# Nightly backup of the OrderDesk database and uploaded photos. Keeps 14 days.
# Installed as a cron job (see deploy/server/README.md):
#   0 21 * * * BACKUP_DIR=/home/ubuntu/orderdesk-backups /home/ubuntu/orderdesk/deploy/server/backup.sh >> ... (02:30 IST)
set -eu
DIR="${BACKUP_DIR:-$HOME/orderdesk-backups}"
STAMP=$(date +%Y-%m-%d_%H%M)
cd "$(dirname "$0")"
mkdir -p "$DIR"

docker compose exec -T db pg_dump -U orderdesk -d orderdesk --format=custom > "$DIR/db_$STAMP.dump"
docker compose exec -T api tar -C /app -czf - uploads > "$DIR/uploads_$STAMP.tar.gz"

find "$DIR" -name 'db_*.dump' -mtime +14 -delete
find "$DIR" -name 'uploads_*.tar.gz' -mtime +14 -delete
echo "$(date -Is) backup ok: db_$STAMP.dump ($(du -h "$DIR/db_$STAMP.dump" | cut -f1))"
