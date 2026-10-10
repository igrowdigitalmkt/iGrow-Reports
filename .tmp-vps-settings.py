import paramiko, pathlib, json
host="179.236.250.51"; instance="igrow-4c49714e-3aec-409a-8c5a-d2dae02f2e3b"
key=str(pathlib.Path.home()/".ssh"/"igrow_vps")
c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(hostname=host, username="root", key_filename=key, timeout=10)
cmd=f"""bash -lc 'cd /opt/evolution && set -a && . ./.env && set +a && curl -fsS -H "apikey: $EVOLUTION_API_KEY" "https://$DOMAIN/settings/find/{instance}" > /tmp/igrow-settings.json'"""
_,o,e=c.exec_command(cmd); rc=o.channel.recv_exit_status()
if rc:
    print("SETTINGS_QUERY_FAILED"); raise SystemExit(rc)
sftp=c.open_sftp()
with sftp.file("/tmp/igrow-settings.json","r") as f: x=json.loads(f.read().decode())
obj=x.get("settings",x) if isinstance(x,dict) else {}
keep={k:obj.get(k) for k in ["syncFullHistory","readMessages","readStatus","groupsIgnore","alwaysOnline"]}
print(json.dumps(keep,ensure_ascii=True))
sftp.close(); c.close()
