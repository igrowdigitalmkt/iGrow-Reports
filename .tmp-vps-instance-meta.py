import paramiko, pathlib, json
host="179.236.250.51"; target="igrow-4c49714e-3aec-409a-8c5a-d2dae02f2e3b"
key=str(pathlib.Path.home()/".ssh"/"igrow_vps")
c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy()); c.connect(hostname=host,username="root",key_filename=key,timeout=10)
cmd="""bash -lc 'cd /opt/evolution && set -a && . ./.env && set +a && curl -fsS -H "apikey: $EVOLUTION_API_KEY" "https://$DOMAIN/instance/fetchInstances" > /tmp/igrow-instances.json'"""
_,o,e=c.exec_command(cmd); rc=o.channel.recv_exit_status()
if rc: raise SystemExit(rc)
sftp=c.open_sftp()
with sftp.file("/tmp/igrow-instances.json","r") as f: rows=json.loads(f.read().decode())
for row in rows if isinstance(rows,list) else []:
    name=row.get("name") or row.get("instanceName")
    if name!=target: continue
    settings=row.get("Setting") or row.get("settings") or {}
    print(json.dumps({
      "name":name,
      "createdAt":row.get("createdAt"),
      "updatedAt":row.get("updatedAt"),
      "connectionStatus":row.get("connectionStatus"),
      "settingCreatedAt":settings.get("createdAt") if isinstance(settings,dict) else None,
      "settingUpdatedAt":settings.get("updatedAt") if isinstance(settings,dict) else None,
      "syncFullHistory":settings.get("syncFullHistory") if isinstance(settings,dict) else None
    },ensure_ascii=True))
sftp.close(); c.close()
