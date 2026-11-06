"use client";

import { WhatsAppInbox } from "./inbox-view";
import { demoInboxChannels, demoInboxConversations, demoInboxThreads } from "./inbox-demo";

/** Caixa do WhatsApp da demonstração pública (/demo): os dados fictícios ficam aqui, fora do pacote das telas reais. */
export function DemoWhatsAppInbox() {
  return <WhatsAppInbox demo channels={demoInboxChannels} demoConversations={demoInboxConversations} demoThreads={demoInboxThreads} />;
}
