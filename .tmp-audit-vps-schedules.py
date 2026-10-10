import paramiko,pathlib
c=paramiko.SSHClient();c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("179.236.250.51",username="root",key_filename=str(pathlib.Path.home()/".ssh"/"igrow_vps"),timeout=10)
checks={
"SCHEDULED_TASKS":"crontab -l 2>/dev/null | sed -E 's/(Bearer |apikey: |password=)[^ ]+/\\1[REDACTED]/Ig' | grep -E '(^[^#].*cron|automations|worker|backup|pg_dump|curl)' | head -35; echo ======; systemctl list-timers --all --no-pager 2>/dev/null | grep -E 'back|dump|evol|cron' | head -18",
"BACKUP_FILES":"find /opt/evolution -maxdepth 3 -type f \\( -iname '*.dump' -o -iname '*.sql.gz' -o -iname '*backup*.tar.gz' \\) -printf '%P %s bytes\\n' 2>/dev/null | head -28",
"VOLUMES":"docker volume ls --format '{{.Name}}' | grep evolution",
"CONTAINER_HEALTH":"cd /opt/evolution && docker compose ps --format 'table {{.Name}}\\t{{.State}}\\t{{.Health}}'",
}
for name,cmd in checks.items():
 print("====",name,"====")
 try:
  _,out,err=c.exec_command(cmd,timeout=15)
  print(out.read().decode("utf-8","replace").encode("ascii","replace").decode()[:4500])
 except Exception as e:print("error",e)
c.close()
