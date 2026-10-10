import pathlib, subprocess
root=pathlib.Path(r"C:\Users\Silvio Melo\Desktop\iGrow-Reports")
source=pathlib.Path(r"C:\Users\Silvio Melo\Desktop\evolution-patch-src")
diff=subprocess.run(["git","diff","--","src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts"],cwd=source,capture_output=True,check=True).stdout
if b"chatModify" not in diff or b"chatsForWebhook" not in diff:
    raise SystemExit("EXPECTED_CHANGES_NOT_FOUND")
(root/"infra/evolution/igrow-chat-state.patch").write_bytes(diff)
print("PATCH_OK",len(diff))
