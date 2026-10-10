import type { InboxMessageItem } from "./inbox-types";
import { kindLabel } from "./inbox-format";

/** Export only the loaded message snapshot; never imply a WhatsApp history backup. */
export function conversationExport(name: string, messages: InboxMessageItem[]) {
  const lines = [name, "Exportação das mensagens carregadas na iGrow. Mídias não incluídas.", ""];
  for (const message of [...messages].sort((a, b) => a.sentAt.localeCompare(b.sentAt))) {
    const author = message.direction === "out" ? "Você" : message.author || name;
    const text = message.revoked ? "Mensagem apagada" : message.body || `[${kindLabel(message.kind)}${message.mediaName ? ": " + message.mediaName : ""}]`;
    const stamp = new Date(message.sentAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    lines.push(`[${stamp}] ${author}: ${text}`);
  }
  return lines.join("\n");
}
