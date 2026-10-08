import paramiko, pathlib, sys, time
host="179.236.250.51"; key=str(pathlib.Path.home()/".ssh"/"igrow_vps")
c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(hostname=host, username="root", key_filename=key, timeout=10)
cmd="cd /opt/evolution && docker compose up -d --no-deps evolution && sleep 8 && docker compose ps evolution"
_,o,e=c.exec_command(cmd)
rc=o.channel.recv_exit_status()
data=o.read().decode("utf-8","replace"); err=e.read().decode("utf-8","replace")
print(data.encode("ascii","replace").decode("ascii"),end="")
if err: print(err.encode("ascii","replace").decode("ascii"),file=sys.stderr)
c.close(); raise SystemExit(rc)
