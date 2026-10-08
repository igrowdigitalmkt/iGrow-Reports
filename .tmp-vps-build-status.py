import paramiko, pathlib
c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("179.236.250.51", username="root", key_filename=str(pathlib.Path.home()/".ssh"/"igrow_vps"), timeout=10)
_,o,e=c.exec_command("tail -40 /tmp/igrow-evo-build.log 2>/dev/null || true")
print(o.read().decode("utf-8","replace").encode("ascii","replace").decode("ascii"), end="")
c.close()
