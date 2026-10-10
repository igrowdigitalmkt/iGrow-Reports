import pathlib, paramiko
host="179.236.250.51"
name="igrow-4c49714e-3aec-409a-8c5a-d2dae02f2e3b"
ssh=paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(hostname=host,username="root",key_filename=str(pathlib.Path.home()/".ssh"/"igrow_vps"),timeout=10)
commands=[
    ("LOGOUT",f'curl -sS -X DELETE -o /tmp/igrow-logout-response -w "%{{http_code}}" -H "apikey: $EVOLUTION_API_KEY" "https://$DOMAIN/instance/logout/{name}"'),
    ("DELETE",f'curl -sS -X DELETE -o /tmp/igrow-delete-response -w "%{{http_code}}" -H "apikey: $EVOLUTION_API_KEY" "https://$DOMAIN/instance/delete/{name}"')
]
for label,action in commands:
    cmd="cd /opt/evolution && set -a && . ./.env && set +a && "+action
    _,out,err=ssh.exec_command("bash -lc "+repr(cmd))
    rc=out.channel.recv_exit_status()
    status=out.read().decode("utf-8","replace").strip()
    print(label,"HTTP",status,"EXIT",rc)
    if rc or (status[:1] not in ["2","4"]):
        print("FAILED",label)
        raise SystemExit(1)
_,out,err=ssh.exec_command("cd /opt/evolution && docker compose ps evolution --format '{{.State}}'")
print("EVOLUTION_CONTAINER",out.read().decode().strip())
ssh.close()
