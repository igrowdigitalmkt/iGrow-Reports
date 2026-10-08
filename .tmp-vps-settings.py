import paramiko, pathlib, sys, json
host="179.236.250.51"; key=str(pathlib.Path.home()/".ssh"/"igrow_vps")
c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy()); c.connect(hostname=host,username="root",key_filename=key,timeout=10)
code=r'''import json, urllib.request, urllib.parse
from pathlib import Path
env={}
for line in Path("/opt/evolution/.env").read_text().splitlines():
    line=line.strip()
    if line and not line.startswith("#") and "=" in line:
        k,v=line.split("=",1); env[k.strip()]=v.strip().strip('"').strip("'")
base="https://"+env["DOMAIN"]; key=env["EVOLUTION_API_KEY"]
def get(path):
    req=urllib.request.Request(base+path,headers={"apikey":key})
    with urllib.request.urlopen(req,timeout=20) as r:return json.loads(r.read().decode() or "{}")
inst=get("/instance/fetchInstances")
if isinstance(inst,dict):inst=inst.get("instances",[])
for row in inst:
    name=row.get("name") or row.get("instanceName") or (row.get("instance") or {}).get("instanceName")
    if not name or not name.startswith("igrow-"):continue
    s=get("/settings/find/"+urllib.parse.quote(name,safe=""))
    allowed=["rejectCall","groupsIgnore","alwaysOnline","readMessages","readStatus","syncFullHistory"]
    print("INSTANCE",name,"SETTINGS",json.dumps({k:s.get(k) for k in allowed if k in s},separators=(",",":")))
'''
sftp=c.open_sftp()
with sftp.file("/tmp/igrow-settings.py","w") as f:f.write(code)
sftp.close()
_,o,e=c.exec_command("python3 /tmp/igrow-settings.py; rc=$?; rm -f /tmp/igrow-settings.py; exit $rc")
rc=o.channel.recv_exit_status(); print(o.read().decode("utf-8","replace"),end=""); err=e.read().decode("utf-8","replace")
if err:print(err,file=sys.stderr)
c.close(); raise SystemExit(rc)
