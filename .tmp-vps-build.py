import paramiko, pathlib, sys
host="179.236.250.51"
root=pathlib.Path(r"C:\Users\Silvio Melo\Desktop\iGrow-Reports")
key=str(pathlib.Path.home()/".ssh"/"igrow_vps")
c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(hostname=host, username="root", key_filename=key, timeout=10, banner_timeout=10, auth_timeout=10)
sftp=c.open_sftp()
for name in ["docker-compose.yml","Dockerfile.igrow","igrow-chat-state.patch","igrow-baileys-chat-state.patch"]:
    data=(root/"infra"/"evolution"/name).read_text(encoding="utf-8").replace("\r\n","\n")
    with sftp.file(f"/opt/evolution/{name}","w") as f: f.write(data)
sftp.close()
cmd="cd /opt/evolution && docker compose config --quiet && (docker compose build evolution > /tmp/igrow-evo-build.log 2>&1); rc=$?; if [ $rc -eq 0 ]; then echo BUILD_OK; else echo BUILD_FAILED; tail -80 /tmp/igrow-evo-build.log; fi; exit $rc"
stdin,out,err=c.exec_command(cmd)
rc=out.channel.recv_exit_status()
data=out.read().decode("utf-8","replace")
e=err.read().decode("utf-8","replace")
safe=lambda s:s.encode("ascii","replace").decode("ascii")
if data: print(safe(data),end="")
if e: print(safe(e),file=sys.stderr)
c.close()
raise SystemExit(rc)
