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
try:
    phone = api("/label/igrowContact/" + instance, {"peer": person["phoneNumber"]})
except urllib.error.HTTPError as error:
    payload = json.load(error)
    messages = payload.get("response", {}).get("message", [])
    if isinstance(messages, str):
        messages = [messages]
    codes = [value for value in messages if isinstance(value, str) and value.startswith("IGROW_CONTACT_")]
    raise RuntimeError("Native contact unavailable: " + ",".join(codes)) from None
assert set(phone) == {"fullName", "firstName", "canEdit"}
assert isinstance(phone["fullName"], str) and phone["fullName"].strip() and phone["canEdit"]
lid = api("/label/igrowContact/" + instance, {"peer": person["id"]})
assert phone == lid
try:
    api("/label/igrowContact/" + instance, {"peer": "99999999999999999999@lid"})
    raise AssertionError("Unknown native contact was accepted")
except urllib.error.HTTPError as error:
    assert error.code == 400
print(json.dumps({"connected": True, "native_saved_contact_available": True,
    "proven_phone_lid_match": True, "unknown_identity_refused": True, "contact_mutations": 0}))
