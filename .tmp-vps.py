import paramiko, pathlib, sys
host="179.236.250.51"
key=str(pathlib.Path.home()/".ssh"/"igrow_vps")
c=paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(hostname=host, username="root", key_filename=key, timeout=10, banner_timeout=10, auth_timeout=10)
stdin, stdout, stderr = c.exec_command("echo connected; cd /opt/evolution && docker compose ps")
print(stdout.read().decode("utf-8", "replace"))
err=stderr.read().decode("utf-8","replace")
if err: print(err, file=sys.stderr)
c.close()
