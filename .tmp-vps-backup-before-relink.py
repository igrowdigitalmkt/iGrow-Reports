import pathlib, paramiko
host="179.236.250.51"
ssh=paramiko.SSHClient(); ssh.set_missing_host_key_policy(paramiko.RejectPolicy())
ssh.load_system_host_keys()
try:
    ssh.connect(hostname=host,username="root",key_filename=str(pathlib.Path.home()/".ssh"/"igrow_vps"),timeout=10,look_for_keys=False)
except paramiko.ssh_exception.SSHException:
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(hostname=host,username="root",key_filename=str(pathlib.Path.home()/".ssh"/"igrow_vps"),timeout=10,look_for_keys=False)
cmd="""set -e
cd /opt/evolution
umask 077
mkdir -p backups
docker compose exec -T postgres pg_dump -U evolution -Fc evolution > backups/evolution-pre-relink.dump
docker compose exec -T evolution tar -czf - -C /evolution/instances . > backups/session-pre-relink.tar.gz
chmod 600 backups/evolution-pre-relink.dump backups/session-pre-relink.tar.gz
wc -c backups/evolution-pre-relink.dump backups/session-pre-relink.tar.gz
"""
_, out, err=ssh.exec_command(cmd)
rc=out.channel.recv_exit_status()
stdout=out.read().decode("utf-8","replace")
stderr=err.read().decode("utf-8","replace")
print(stdout)
if rc: print("BACKUP_ERROR",stderr[:1000]); raise SystemExit(rc)
print("BACKUP_OK")
ssh.close()
