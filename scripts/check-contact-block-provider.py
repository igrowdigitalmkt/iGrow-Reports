"""Read-only VPS smoke check; outputs booleans only, never contact identifiers or keys."""
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
    with urllib.request.urlopen(request, timeout=55) as response:
        return json.load(response)

instance = "igrow-4c49714e-3aec-409a-8c5a-d2dae02f2e3b"
owner = next(row for row in api("/instance/fetchInstances?instanceName=" + instance) if row["name"] == instance)["ownerJid"].split(":")[0].split("@")[0]
groups = api("/group/fetchAllGroups/" + instance + "?getParticipants=true")
contact = next(person for group in groups for person in group.get("participants", [])
    if person.get("phoneNumber", "").split("@")[0] != owner and person.get("phoneNumber") and str(person.get("id", "")).endswith("@lid"))
# Omitting 'blocked' requests current native state and cannot block/unblock the contact.
phone = api("/label/igrowContactBlock/" + instance, {"peer": contact["phoneNumber"]})
assert isinstance(phone.get("blocked"), bool) and list(phone) == ["blocked"]
try:
    lid = api("/label/igrowContactBlock/" + instance, {"peer": contact["id"]})
    assert phone == lid
    lid_available = True
except urllib.error.HTTPError as error:
    # An unproven LID must be refused, rather than guessed from phone/name metadata.
    assert error.code == 400
    lid_available = False
try:
    api("/label/igrowContactBlock/" + instance, {"peer": owner + "@s.whatsapp.net"})
    raise AssertionError("Self-block protection missing")
except urllib.error.HTTPError as error:
    assert error.code == 400
    body = json.load(error)
    assert "Cannot block the connected account" in body["response"]["message"]
print(json.dumps({"connected": api("/instance/connectionState/" + instance)["instance"]["state"] == "open",
    "native_phone_state_confirmed": True, "lid_state_available": lid_available, "own_account_protected": True, "mutations": 0}))
