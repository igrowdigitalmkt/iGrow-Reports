import paramiko, pathlib, shlex
name="igrow-4c49714e-3aec-409a-8c5a-d2dae02f2e3b"
jid="120363150097840207@g.us"
js = '''
(async()=>{
 const crypto=require("node:crypto");
 const instance="REPLACE_INSTANCE";
 const token=crypto.createHmac("sha256",process.env.AUTHENTICATION_API_KEY).update("webhook:"+instance).digest("hex");
 async function change(archived){
   const r=await fetch("https://i-grow-reports.vercel.app/api/webhooks/evolution",{
     method:"POST",headers:{"Content-Type":"application/json","x-igrow-token":token},
     body:JSON.stringify({event:"chats.update",instance,data:[{remoteJid:"REPLACE_JID",archived,name:"Grupo de teste"}]})
   });
   console.log("ARCHIVED",archived,"HTTP",r.status,"BODY",(await r.text()).slice(0,250));
   return r.ok;
 }
 try{await change(false);}finally{await change(true);}
})().catch(e=>{console.error("TEST_ERROR",e.message);process.exit(1)});
'''.replace("REPLACE_INSTANCE",name).replace("REPLACE_JID",jid)
c=paramiko.SSHClient();c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("179.236.250.51",username="root",key_filename=str(pathlib.Path.home()/".ssh"/"igrow_vps"),timeout=10)
cmd="cd /opt/evolution && docker compose exec -T evolution node -e "+shlex.quote(js)
_,o,e=c.exec_command(cmd);rc=o.channel.recv_exit_status()
print("EXIT",rc)
print(o.read().decode("utf-8","replace").encode("ascii","replace").decode())
print(e.read().decode("utf-8","replace")[:300])
c.close()
