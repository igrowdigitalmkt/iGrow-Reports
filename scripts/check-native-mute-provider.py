"""Read-only native-contact smoke check. Never renames contacts or prints names/keys."""
import json
import pathlib
import subprocess
import urllib.request
import urllib.error

env = dict(line.split("=", 1) for line in pathlib.Path("/opt/evolution/.env").read_text().splitlines() if "=" in line and not line.startswith("#"))
key = env["EVOLUTION_API_KEY"].strip().strip('"').strip("'")
container = json.loads(subprocess.check_output(["docker", "inspect", "evolution-evolution-1"]))[0]
ip = next(iter(container["NetworkSettings"]["Networks"].values()))["IPAddress"]

def api(path, data=None):
    request = urllib.request.Request("http://" + ip + ":8080" + path,
        data=json.dumps(data).encode() if data is not None else None,
        headers={"apikey": key, "Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=65) as response:
        return json.load(response)

instance = "igrow-4c49714e-3aec-409a-8c5a-d2dae02f2e3b"
assert api("/instance/connectionState/" + instance)["instance"]["state"] == "open"
owner = next(row for row in api("/instance/fetchInstances?instanceName=" + instance) if row["name"] == instance)["ownerJid"].split(":")[0].split("@")[0]
groups = api("/group/fetchAllGroups/" + instance + "?getParticipants=true")
person = next(person for group in groups for person in group.get("participants", [])
    if person.get("phoneNumber", "").split("@")[0] != owner and person.get("phoneNumber"))
# The bridge only reads when fullName is omitted.

import time
result = api("/label/igrowMute/" + instance, {"peer": person["phoneNumber"]})
assert isinstance(result.get("muted"), bool)
until=result.get("until")
print(json.dumps({"connected":True,"mute_read_verified":True,"mutations":0,"has_until":until is not None,"epoch_seconds":isinstance(until,int) and 1500000000 < until < 4000000000,"epoch_milliseconds":isinstance(until,int) and 1500000000000 < until < 4000000000000}))

peers=list(dict.fromkeys(p["phoneNumber"] for g in groups for p in g.get("participants",[]) if p.get("phoneNumber")))[:20]
units=set()
for peer in peers:
    result=api("/label/igrowMute/"+instance,{"peer":peer})
    until=result.get("until")
    if result.get("muted") and isinstance(until,int):
        units.add("epoch_seconds" if 1500000000 < until < 4000000000 else "epoch_milliseconds" if 1500000000000 < until < 4000000000000 else "other")
print(json.dumps({"read_only_peers_checked":len(peers),"native_mute_units":sorted(units),"mutations":0}))
