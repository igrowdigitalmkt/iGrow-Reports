import paramiko, pathlib, json, sys
host="179.236.250.51"; key=str(pathlib.Path.home()/".ssh"/"igrow_vps")
c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(hostname=host, username="root", key_filename=key, timeout=10)
cmd="""bash -lc 'cd /opt/evolution && set -a && . ./.env && set +a && curl -fsS -H "apikey: $EVOLUTION_API_KEY" "https://$DOMAIN/instance/fetchInstances" > /tmp/igrow-instances.json'"""
_,o,e=c.exec_command(cmd); rc=o.channel.recv_exit_status()
if rc:
    print("INSTANCE_QUERY_FAILED"); print(e.read().decode("utf-8","replace")); raise SystemExit(rc)
sftp=c.open_sftp()
with sftp.file("/tmp/igrow-instances.json","r") as f: data=json.loads(f.read().decode())
rows=data if isinstance(data,list) else data.get("instances",[]) if isinstance(data,dict) else []
for row in rows:
    name=row.get("name") or row.get("instanceName") or (row.get("instance") or {}).get("instanceName")
    state=row.get("connectionStatus") or row.get("state") or (row.get("instance") or {}).get("state")
    if not name: continue
    print(f"INSTANCE {name} STATE {state}")
    safe=name.replace("'","")
    cmd2=f"""bash -lc 'cd /opt/evolution && set -a && . ./.env && set +a && curl -fsS -H "apikey: $EVOLUTION_API_KEY" "https://$DOMAIN/webhook/find/{safe}" > /tmp/igrow-webhook.json'"""
    _,o2,e2=c.exec_command(cmd2); rc2=o2.channel.recv_exit_status()
    if rc2==0:
        with sftp.file("/tmp/igrow-webhook.json","r") as f: wh=json.loads(f.read().decode())
        obj=wh.get("webhook",wh) if isinstance(wh,dict) else {}
        print("EVENTS "+",".join(obj.get("events") or []))
    else:
        print("WEBHOOK_QUERY_FAILED")
sftp.close(); c.close()
