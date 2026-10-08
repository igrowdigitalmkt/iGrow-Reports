import paramiko, pathlib, sys
host="179.236.250.51"; key=str(pathlib.Path.home()/".ssh"/"igrow_vps")
c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy()); c.connect(hostname=host,username="root",key_filename=key,timeout=10)
remote=r'''import json, urllib.request, urllib.parse
from pathlib import Path
env={}
for line in Path("/opt/evolution/.env").read_text().splitlines():
    line=line.strip()
    if line and not line.startswith("#") and "=" in line:
        k,v=line.split("=",1); env[k.strip()]=v.strip().strip('"').strip("'")
base="https://"+env["DOMAIN"]; key=env["EVOLUTION_API_KEY"]
def call(path,method="GET",body=None):
    req=urllib.request.Request(base+path,data=None if body is None else json.dumps(body).encode(),method=method,
        headers={"apikey":key,"Content-Type":"application/json"})
    with urllib.request.urlopen(req,timeout=20) as r:return json.loads(r.read().decode() or "{}")
inst=call("/instance/fetchInstances")
if isinstance(inst,dict):inst=inst.get("instances",[])
for row in inst:
    name=row.get("name") or row.get("instanceName") or (row.get("instance") or {}).get("instanceName")
    if not name or not name.startswith("igrow-"):continue
    current=call("/settings/find/"+urllib.parse.quote(name,safe=""))
    allowed=["rejectCall","msgCall","groupsIgnore","alwaysOnline","readMessages","readStatus","syncFullHistory","wavoipToken"]
    payload={k:current[k] for k in allowed if k in current}
    payload["syncFullHistory"]=True
    call("/settings/set/"+urllib.parse.quote(name,safe=""),"POST",payload)
    print("FULL_HISTORY_ENABLED",name)
'''
sftp=c.open_sftp()
with sftp.file("/tmp/igrow-full-sync.py","w") as f:f.write(remote)
sftp.close()
_,o,e=c.exec_command("python3 /tmp/igrow-full-sync.py; rc=$?; rm -f /tmp/igrow-full-sync.py; exit $rc")
rc=o.channel.recv_exit_status(); print(o.read().decode("utf-8","replace"),end=""); err=e.read().decode("utf-8","replace")
if err: print(err,file=sys.stderr)
if rc: c.close(); raise SystemExit(rc)
_,o,e=c.exec_command("cd /opt/evolution && docker compose restart evolution >/dev/null 2>&1 && sleep 12 && docker compose ps evolution")
rc=o.channel.recv_exit_status(); print(o.read().decode("utf-8","replace").encode("ascii","replace").decode("ascii"),end=""); err=e.read().decode("utf-8","replace")
if err: print(err.encode("ascii","replace").decode("ascii"),file=sys.stderr)
c.close(); raise SystemExit(rc)
