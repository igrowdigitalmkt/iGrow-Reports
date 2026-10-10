import paramiko, pathlib, json, sys
HOST="179.236.250.51"
INSTANCE="igrow-4c49714e-3aec-409a-8c5a-d2dae02f2e3b"
CHAT="558695494659"
archive=(len(sys.argv)<2 or sys.argv[1].lower()!="false")
body={
  "chat": CHAT+"@s.whatsapp.net",
  "archive": archive,
  "lastMessage": {
    "key": {"remoteJid": CHAT+"@s.whatsapp.net", "fromMe": False, "id": "A59E975D646841C81A8510B0BBD182C9"},
    "messageTimestamp": 1791400955
  }
}
c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username="root", key_filename=str(pathlib.Path.home()/".ssh"/"igrow_vps"), timeout=10)
sftp=c.open_sftp()
with sftp.file("/tmp/igrow-archive.json","w") as f: f.write(json.dumps(body))
sftp.close()
cmd=f"""bash -lc 'cd /opt/evolution && set -a && . ./.env && set +a && curl -sS -X POST -H "apikey: $EVOLUTION_API_KEY" -H "Content-Type: application/json" --data-binary @/tmp/igrow-archive.json "https://$DOMAIN/chat/archiveChat/{INSTANCE}"'"""
_,o,e=c.exec_command(cmd)
rc=o.channel.recv_exit_status(); out=o.read().decode("utf-8","replace"); err=e.read().decode("utf-8","replace")
print(("ARCHIVE" if archive else "UNARCHIVE"),"RC",rc,"RESP",out[:6000].encode("ascii","replace").decode("ascii"))
if err: print("ERR",err[:500].encode("ascii","replace").decode("ascii"))
c.close()
