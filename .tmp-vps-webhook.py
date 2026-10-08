import paramiko, pathlib, sys, textwrap
host="179.236.250.51"; key=str(pathlib.Path.home()/".ssh"/"igrow_vps")
remote_code=r'''import json, ssl, urllib.request, urllib.parse
from pathlib import Path

def envfile(path):
    out={}
    for line in Path(path).read_text().splitlines():
        line=line.strip()
        if not line or line.startswith("#") or "=" not in line: continue
        k,v=line.split("=",1); out[k.strip()]=v.strip().strip('"').strip("'")
    return out

env=envfile("/opt/evolution/.env")
base="https://"+env["DOMAIN"]
key=env["EVOLUTION_API_KEY"]
def call(path, method="GET", body=None):
    data=None if body is None else json.dumps(body).encode()
    req=urllib.request.Request(base+path, data=data, method=method, headers={"apikey":key,"Content-Type":"application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode() or "{}")

instances=call("/instance/fetchInstances")
if isinstance(instances,dict): instances=instances.get("instances",[])
events=["MESSAGES_UPSERT","MESSAGES_UPDATE","SEND_MESSAGE","CHATS_UPSERT","CHATS_UPDATE"]
for row in instances:
    name=row.get("name") or row.get("instanceName") or (row.get("instance") or {}).get("instanceName")
    if not name or not name.startswith("igrow-"): continue
    current=call("/webhook/find/"+urllib.parse.quote(name,safe=""))
    wh=current.get("webhook",current) if isinstance(current,dict) else {}
    payload={"webhook":{
        "enabled": True,
        "url": wh.get("url"),
        "headers": wh.get("headers") or {},
        "byEvents": bool(wh.get("byEvents",False)),
        "base64": bool(wh.get("base64",False)),
        "events": events,
    }}
    if not payload["webhook"]["url"]: raise RuntimeError("webhook URL ausente")
    call("/webhook/set/"+urllib.parse.quote(name,safe=""),"POST",payload)
    check=call("/webhook/find/"+urllib.parse.quote(name,safe=""))
    got=(check.get("webhook",check) if isinstance(check,dict) else {}).get("events") or []
    print("WEBHOOK",name,"EVENTS",",".join(got))
'''
c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(hostname=host, username="root", key_filename=key, timeout=10)
sftp=c.open_sftp()
with sftp.file("/tmp/igrow-update-webhooks.py","w") as f: f.write(remote_code)
sftp.close()
_,o,e=c.exec_command("python3 /tmp/igrow-update-webhooks.py; rc=$?; rm -f /tmp/igrow-update-webhooks.py; exit $rc")
rc=o.channel.recv_exit_status()
data=o.read().decode("utf-8","replace"); err=e.read().decode("utf-8","replace")
if data: print(data,end="")
if err: print(err,file=sys.stderr)
c.close(); raise SystemExit(rc)
