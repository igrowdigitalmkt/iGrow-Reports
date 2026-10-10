import paramiko, pathlib, shlex, json, sys
name="igrow-4c49714e-3aec-409a-8c5a-d2dae02f2e3b"
jid="120363150097840207@g.us"
archive = sys.argv[1].lower() == "true" if len(sys.argv)>1 else True
js = """
(async () => {
 const r=await fetch("http://127.0.0.1:8080/chat/archiveChat/REPLACE_INSTANCE",
 {method:"POST",headers:{"apikey":process.env.AUTHENTICATION_API_KEY,"Content-Type":"application/json"},
 body:JSON.stringify({chat:"REPLACE_JID", archive:REPLACE_BOOL})});
 console.log("STATUS",r.status);
 console.log("BODY",(await r.text()).slice(0,1200));
})().catch(e=>{console.error(e.message);process.exit(1)});
""".replace("REPLACE_INSTANCE",name).replace("REPLACE_JID",jid).replace("REPLACE_BOOL","true" if archive else "false")
client=paramiko.SSHClient();client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("179.236.250.51",username="root",key_filename=str(pathlib.Path.home()/".ssh"/"igrow_vps"),timeout=10)
cmd="cd /opt/evolution && docker compose exec -T evolution node -e "+shlex.quote(js)
_,out,err=client.exec_command(cmd)
rc=out.channel.recv_exit_status();print("EXIT",rc)
print(out.read().decode("utf-8","replace").encode("ascii","replace").decode())
print(err.read().decode("utf-8","replace")[:500])
client.close()
