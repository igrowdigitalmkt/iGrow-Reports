import paramiko, pathlib, sys
host="179.236.250.51"
root=pathlib.Path(r"C:\Users\Silvio Melo\Desktop\iGrow-Reports")
key=str(pathlib.Path.home()/".ssh"/"igrow_vps")
c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(hostname=host, username="root", key_filename=key, timeout=10, banner_timeout=10, auth_timeout=10)
def run(cmd, stream=False):
    stdin,out,err=c.exec_command(cmd, get_pty=stream)
    if stream:
        for line in iter(out.readline,""): print(line,end="",flush=True)
        rc=out.channel.recv_exit_status()
        e=err.read().decode("utf-8","replace")
    else:
        rc=out.channel.recv_exit_status()
        data=out.read().decode("utf-8","replace")
        e=err.read().decode("utf-8","replace")
        if data: print(data,end="")
    if e: print(e,file=sys.stderr)
    if rc: raise SystemExit(rc)
sftp=c.open_sftp()
for name in ["docker-compose.yml","Dockerfile.igrow","igrow-chat-state.patch"]:
    data=(root/"infra"/"evolution"/name).read_text(encoding="utf-8").replace("\r\n","\n")
    with sftp.file(f"/opt/evolution/{name}","w") as f: f.write(data)
sftp.close()
run("cd /opt/evolution && docker compose config --quiet")
print("compose-ok", flush=True)
run("cd /opt/evolution && docker compose build evolution", stream=True)
print("build-ok", flush=True)
c.close()
