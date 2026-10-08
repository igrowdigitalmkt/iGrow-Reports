import paramiko,pathlib,sys
c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("179.236.250.51",username="root",key_filename=str(pathlib.Path.home()/".ssh"/"igrow_vps"),timeout=10)
cmd='bash -lc \'cd /opt/evolution && set -a && . ./.env && set +a && curl -fsS --max-time 120 -X POST -H "apikey: $EVOLUTION_API_KEY" -H "Content-Type: application/json" "https://$DOMAIN/chat/resyncIgrowChatState/igrow-4c49714e-3aec-409a-8c5a-d2dae02f2e3b"\''
_,o,e=c.exec_command(cmd)
rc=o.channel.recv_exit_status()
data=o.read().decode("utf-8","replace"); err=e.read().decode("utf-8","replace")
print(data[:500])
if err: print(err[:500],file=sys.stderr)
c.close(); raise SystemExit(rc)
