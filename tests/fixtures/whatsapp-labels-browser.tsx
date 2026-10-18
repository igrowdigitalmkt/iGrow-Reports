import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CustomListMembership, useCustomLists } from "../../src/modules/whatsapp/custom-lists";

function LabelsHarness() {
  const [channel, setChannel] = useState("qr");
  const lists = useCustomLists(channel, false);
  return <main>
    <button onClick={() => setChannel(channel === "qr" ? "official" : "qr")}>Trocar canal</button>
    <button onClick={() => void lists.refresh().catch(() => {})}>Consultar</button>
    <button onClick={() => void lists.create("Nova", "#c15add", [])}>Criar</button>
    <output data-testid="channel">{channel}</output>
    <output data-testid="busy">{String(lists.busy)}</output>
    <output data-testid="error">{lists.error}</output>
    <output data-testid="lists">{JSON.stringify(lists.lists)}</output>
    <CustomListMembership lists={lists.lists} conversationId="44444444-4444-4444-8444-444444444444"
      busy={lists.membershipBlocked} onToggle={(list, member) => lists.setMember(list.id, "44444444-4444-4444-8444-444444444444", member)} />
  </main>;
}

createRoot(document.getElementById("root")!).render(<LabelsHarness />);
