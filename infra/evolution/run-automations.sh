#!/bin/sh
# Every 5 minutes: asks the iGrow to send the scheduled messages that are due.
# The secret stays in /opt/igrow/cron.env (CRON_SECRET=..., chmod 600). flock skips a call
# while the previous one is still running.
# Installation: /opt/igrow/run-automations.sh (chmod 700) and /etc/cron.d/igrow-automations with
#   */5 * * * * root flock -n /run/igrow-automations.lock /opt/igrow/run-automations.sh >> /var/log/igrow-automations.log 2>&1
set -eu
. /opt/igrow/cron.env
status=$(curl -s -m 290 -o /tmp/igrow-automations.json -w "%{http_code}" -H "Authorization: Bearer $CRON_SECRET" https://i-grow-reports.vercel.app/api/cron/report-automations || echo 000)
echo "$(date -Is) HTTP $status $(head -c 300 /tmp/igrow-automations.json 2>/dev/null)"
