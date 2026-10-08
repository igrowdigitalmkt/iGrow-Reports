import paramiko,pathlib,sys
c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("179.236.250.51",username="root",key_filename=str(pathlib.Path.home()/".ssh"/"igrow_vps"),timeout=10)
cmd="cd /opt/evolution && docker compose logs --since=15m evolution 2>&1 | grep -Ei 'resync|regular_low|restored state|sync action|unprocessable|chats.update|archive|webhook' | tail -160"
_,o,e=c.exec_command(cmd); rc=o.channel.recv_exit_status()
data=o.read().decode("utf-8","replace"); err=e.read().decode("utf-8","replace")
print(data.encode("ascii","replace").decode("ascii"),end="")
if err: print(err.encode("ascii","replace").decode("ascii"),file=sys.stderr)
c.close()
