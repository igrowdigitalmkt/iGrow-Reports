import paramiko,pathlib,sys
c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("179.236.250.51",username="root",key_filename=str(pathlib.Path.home()/".ssh"/"igrow_vps"),timeout=10)
remote=r'''import json,urllib.request,urllib.parse
from pathlib import Path
env={}
for line in Path("/opt/evolution/.env").read_text().splitlines():
    line=line.strip()
    if line and not line.startswith("#") and "=" in line:
        k,v=line.split("=",1);env[k.strip()]=v.strip().strip('"').strip("'")
base="https://"+env["DOMAIN"];key=env["EVOLUTION_API_KEY"]
def call(path,method="GET",body=None):
    req=urllib.request.Request(base+path,data=None if body is None else json.dumps(body).encode(),method=method,headers={"apikey":key,"Content-Type":"application/json"})
    with urllib.request.urlopen(req,timeout=20) as r:return json.loads(r.read().decode() or "{}")
inst=call("/instance/fetchInstances")
if isinstance(inst,dict):inst=inst.get("instances",[])
for row in inst:
    name=row.get("name") or row.get("instanceName") or (row.get("instance") or {}).get("instanceName")
    if not name or not name.startswith("igrow-"):continue
    try:
        data=call("/chat/findChats/"+urllib.parse.quote(name,safe=""),"POST",{})
        if isinstance(data,list): n=len(data)
        elif isinstance(data,dict):
            if isinstance(data.get("records"),list): n=len(data["records"])
            elif isinstance(data.get("chats"),list): n=len(data["chats"])
            else: n=-1
        else:n=-1
        print("FIND_CHATS_COUNT",n,"TYPE",type(data).__name__)
    except Exception as e:print("FIND_CHATS_ERROR",type(e).__name__,str(e)[:120])
'''
sftp=c.open_sftp()
with sftp.file("/tmp/igrow-find-chats.py","w") as f:f.write(remote)
sftp.close()
_,o,e=c.exec_command("python3 /tmp/igrow-find-chats.py; rc=$?; rm -f /tmp/igrow-find-chats.py; exit $rc")
rc=o.channel.recv_exit_status();print(o.read().decode("utf-8","replace"),end="");err=e.read().decode("utf-8","replace")
if err:print(err,file=sys.stderr)
c.close()
