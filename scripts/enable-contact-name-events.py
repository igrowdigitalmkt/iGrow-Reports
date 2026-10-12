"""Preserve the signed webhook; enable native saved/business/profile name events."""
import json
import pathlib
import subprocess
import urllib.request
from urllib.parse import urlparse

env = dict(line.split("=", 1) for line in pathlib.Path("/opt/evolution/.env").read_text().splitlines() if "=" in line and not line.startswith("#"))
key = env["EVOLUTION_API_KEY"].strip().strip('"').strip("'")
container = json.loads(subprocess.check_output(["docker", "inspect", "evolution-evolution-1"]))[0]
ip = next(iter(container["NetworkSettings"]["Networks"].values()))["IPAddress"]
instance = "igrow-4c49714e-3aec-409a-8c5a-d2dae02f2e3b"
def api(path, data=None):
    request = urllib.request.Request("http://" + ip + ":8080" + path,
        data=json.dumps(data).encode() if data is not None else None,
        headers={"apikey": key, "Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)
webhook = api("/webhook/find/" + instance)
url = urlparse(webhook["url"])
assert webhook["enabled"] and url.scheme == "https" and url.hostname == "i-grow-reports.vercel.app" and url.path == "/api/webhooks/evolution"
assert webhook["headers"].get("x-igrow-token")
events = list(webhook["events"])
missing_events = [event for event in ["CONTACTS_UPSERT", "CONTACTS_UPDATE"] if event not in events]
if missing_events:
    events.extend(missing_events)
    api("/webhook/set/" + instance, {"webhook": {"enabled": True, "url": webhook["url"], "headers": webhook["headers"],
        "events": events, "byEvents": webhook["webhookByEvents"], "base64": webhook["webhookBase64"]}})
updated = api("/webhook/find/" + instance)
assert set(updated["events"]) == set(events) and updated["headers"] == webhook["headers"] and updated["url"] == webhook["url"]
# Empty contact event verifies the real signature/session guard without changing any data.
request = urllib.request.Request(updated["url"], data=json.dumps({"instance": instance, "event": "contacts.upsert", "data": []}).encode(),
    headers={**updated["headers"], "Content-Type": "application/json"})
with urllib.request.urlopen(request, timeout=30) as response:
    result = json.load(response)
assert result.get("contacts") == 0 and "ignored" not in result
print(json.dumps({"native_contact_events_enabled": True, "signature_preserved": True, "existing_events_preserved": True,
    "app_accepts_scoped_contact_events": True}))
