"""One-time encrypted baseline for WhatsApp QR retention; read-only on Supabase."""
import base64, datetime, gzip, hashlib, io, json, os, pathlib, time, urllib.parse, urllib.request
import paramiko
from cryptography.fernet import Fernet

repo = pathlib.Path(__file__).resolve().parent
env = {}
for line in (repo / ".env.production.local").read_text(encoding="utf-8-sig").splitlines():
    if "=" not in line or line.lstrip().startswith("#"): continue
    name, raw = line.split("=", 1)
    env[name.strip()] = raw.strip().strip('"').strip("'")
base = env.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
key = env.get("SUPABASE_SERVICE_ROLE_KEY", "") or env.get("SUPABASE_SECRET_KEY", "")
if not (base.startswith("https://") and key and "supabase.co" in base):
    raise SystemExit("ABORT: Missing verified Supabase credentials")
local = pathlib.Path(os.environ["LOCALAPPDATA"]) / "iGrow" / "Backups"
local.mkdir(parents=True, exist_ok=True)
key_path = local / "igrow-backup-fernet.key"
if not key_path.exists():
    with os.fdopen(os.open(key_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as f: f.write(Fernet.generate_key())
cipher = Fernet(key_path.read_bytes().strip())

def export_rows(table, stream):
    last = None
    count = 0
    while True:
        params = {"select":"*", "order":"id.asc", "limit":"250"}
        if last is not None: params["id"] = "gt."+last
        query = urllib.parse.urlencode(params)
        req = urllib.request.Request(base+"/rest/v1/"+table+"?"+query, headers={
            "apikey":key,"Authorization":"Bearer "+key,"Accept":"application/json"
        })
        with urllib.request.urlopen(req,timeout=25) as res:
            if res.status != 200: raise RuntimeError(table+" HTTP "+str(res.status))
            rows = json.load(res)
        if not isinstance(rows,list): raise RuntimeError("Unexpected response for "+table)
        for row in rows:
            stream.write((json.dumps({"table":table,"row":row},separators=(",",":"),ensure_ascii=False)+"\n").encode("utf8"))
        count+=len(rows)
        if count>100000: raise RuntimeError("ABORT >100k rows, review capacity first")
        if not rows or len(rows)<250: break
        last=rows[-1]["id"]
        time.sleep(.2)
    return count

buffer = io.BytesIO()
counts={}
with gzip.GzipFile(fileobj=buffer,mode="wb",compresslevel=6) as gz:
    for table in ("whatsapp_conversations","whatsapp_messages"):
        counts[table]=export_rows(table,gz)
date=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d-%H%M%S")
body=buffer.getvalue()
manifest={"created_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),"tables":counts,"sha256_gzip":hashlib.sha256(body).hexdigest(),"bytes_compressed":len(body),"type":"supabase-whatsapp-jsonl-gzip"}
plaintext=json.dumps(manifest,separators=(",",":")).encode()+b"\n"+body
encrypted=cipher.encrypt(plaintext)
filename=f"igrow-whatsapp-baseline-{date}.enc"
filepath=local/filename
filepath.write_bytes(encrypted)
# Verify local decrypt before sending.
dec=cipher.decrypt(filepath.read_bytes())
header,compressed=dec.split(b"\n",1)
assert hashlib.sha256(compressed).hexdigest()==json.loads(header)["sha256_gzip"]
s=paramiko.SSHClient()
s.set_missing_host_key_policy(paramiko.AutoAddPolicy())
s.connect("179.236.250.51",username="root",key_filename=str(pathlib.Path.home()/".ssh"/"igrow_vps"),timeout=10)
stdin,stdout,stderr=s.exec_command("install -d -m 0700 /opt/backups/igrow")
if stdout.channel.recv_exit_status():raise RuntimeError("Cannot provision backup directory")
remote="/opt/backups/igrow/"+filename
sftp=s.open_sftp()
with sftp.file(remote,"wb") as f:f.write(encrypted)
sftp.chmod(remote,0o600)
remote_bytes=sftp.stat(remote).st_size
stdin,stdout,stderr=s.exec_command("sha256sum "+remote)
remote_hash=stdout.read().decode().split()[0]
assert remote_hash==hashlib.sha256(encrypted).hexdigest() and remote_bytes==len(encrypted)
sftp.close();s.close()
print("BACKUP_OK encrypted=true tables="+json.dumps(counts)+" source_bytes="+str(len(body))+" archive_bytes="+str(len(encrypted)))
print("BACKUP_VPS /opt/backups/igrow/"+filename)
print("BACKUP_LOCAL "+str(filepath))
print("RESTORE_KEY_LOCAL "+str(key_path)+" (not printed or transferred)")
