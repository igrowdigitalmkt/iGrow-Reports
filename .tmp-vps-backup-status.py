import paramiko,pathlib
c=paramiko.SSHClient();c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("179.236.250.51",username="root",key_filename=str(pathlib.Path.home()/".ssh"/"igrow_vps"),timeout=10)
commands={
 "backup_scripts":"ls -ld /opt/evolution/backup.sh /opt/igrow/run-automations.sh /opt/backups /opt/evolution/backups 2>/dev/null || true; find /opt/backups /opt/evolution/backups -maxdepth 1 -type f -printf '%TY-%Tm-%Td %TH:%TM %f %s bytes\\n' 2>/dev/null | tail -20",
 "cron_jobs":"ls -l /etc/cron.d 2>/dev/null; grep -R -l -E 'evolution-backup|igrow-automations' /etc/cron.d /etc/crontab 2>/dev/null || true",
 "docker_capabilities":"docker version --format '{{.Server.Version}}'",
}
for k,cmd in commands.items():
 _,out,e=c.exec_command(cmd,timeout=15)
 print("=== "+k+" ===\n"+out.read().decode("utf8","replace").encode("ascii","replace").decode()[:7000])
c.close()
