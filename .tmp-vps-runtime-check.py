import paramiko, pathlib
c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("179.236.250.51",username="root",key_filename=str(pathlib.Path.home()/".ssh"/"igrow_vps"),timeout=10)
checks=[
 "grep -F 'Contact lookup skipped while resolving WhatsApp number' /evolution/dist/main.js >/dev/null && echo FALLBACK_PRESENT || echo FALLBACK_MISSING",
 "grep -F 'archived:chat.archived' /evolution/dist/main.js >/dev/null && echo CHAT_STATE_PATCH_PRESENT || echo CHAT_STATE_PATCH_CHECK_NO_LITERAL"
]
for inner in checks:
 _,o,e=c.exec_command("cd /opt/evolution && docker compose exec -T evolution sh -lc "+repr(inner))
 print(o.read().decode("utf-8","replace"),end="")
c.close()
