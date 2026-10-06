#!/bin/sh
# Backup diário da Evolution API (conexões do WhatsApp e banco), guardado 7 dias em /opt/backups.
# Instalação: /opt/evolution/backup.sh (chmod 700) e /etc/cron.d/evolution-backup com
#   30 3 * * * root /opt/evolution/backup.sh >> /var/log/evolution-backup.log 2>&1
set -eu
cd /opt/evolution
stamp=$(date +%Y%m%d-%H%M)
mkdir -p /opt/backups && chmod 700 /opt/backups
docker compose exec -T postgres pg_dump -U evolution -Fc evolution > "/opt/backups/evolution-db-$stamp.dump"
docker run --rm -v evolution_evolution_instances:/data:ro -v /opt/backups:/backup alpine tar czf "/backup/evolution-instances-$stamp.tar.gz" -C /data .
cp /opt/evolution/.env "/opt/backups/evolution-env-$stamp"
chmod 600 /opt/backups/*
find /opt/backups -type f -mtime +7 -delete
