import paramiko, pathlib
c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("179.236.250.51", username="root", key_filename=str(pathlib.Path.home()/".ssh"/"igrow_vps"), timeout=10)
cmd="cd /opt/evolution && docker compose logs --since=8m evolution 2>&1 | tail -500"
_,o,e=c.exec_command(cmd)
data=o.read().decode("utf-8","replace")
for line in data.splitlines():
    low=line.lower()
    if any(k in low for k in ["history","peerdata","pdo","full","sync","archive","chat","webhook","error","warn"]):
        print(line.encode("ascii","replace").decode("ascii"))
c.close()
