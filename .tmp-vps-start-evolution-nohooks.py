import paramiko, pathlib
c=paramiko.SSHClient();c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("179.236.250.51",username="root",key_filename=str(pathlib.Path.home()/".ssh"/"igrow_vps"),timeout=10)
cmd="cd /opt/evolution && docker compose start evolution && docker compose ps evolution --format 'table {{.Name}}\t{{.State}}'"
_,o,e=c.exec_command(cmd);rc=o.channel.recv_exit_status()
print("EXIT",rc)
print(o.read().decode("utf-8","replace").encode("ascii","replace").decode()[-1000:])
print(e.read().decode("utf-8","replace").encode("ascii","replace").decode()[-500:])
c.close();raise SystemExit(rc)
