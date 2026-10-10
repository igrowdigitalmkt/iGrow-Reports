import paramiko,pathlib
c=paramiko.SSHClient();c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("179.236.250.51",username="root",key_filename=str(pathlib.Path.home()/".ssh"/"igrow_vps"),timeout=10)
cmd="""bash -lc '. /opt/igrow/cron.env; curl --silent --show-error --max-time 25 --retry 0 -w " HTTP=%{http_code} ELAPSED=%{time_total}\\n" -H "Authorization: Bearer $CRON_SECRET" https://i-grow-reports.vercel.app/api/cron/whatsapp-retention'"""
_,o,e=c.exec_command(cmd,timeout=30)
out=o.read().decode("utf8","replace")
err=e.read().decode("utf8","replace")
print("RETENTION",out[:1200])
if err:print("WARNING",err[:500])
c.close()
