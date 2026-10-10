import { expect, it } from "vitest";
import { conversationExport } from "@/modules/whatsapp/conversation-export";
import type { InboxMessageItem } from "@/modules/whatsapp/inbox-types";
const message = (values: Partial<InboxMessageItem>): InboxMessageItem => ({ id:"a",direction:"in",kind:"text",body:"Olá ❤️",mediaName:null,mediaMime:null,author:null,status:"read",sentAt:"2026-10-10T12:00:00Z",...values });
it("preserves Unicode, multiline text and author while stating the export scope", () => {
  const output = conversationExport("Contato", [message({ author:"Pessoa",body:"Olá ❤️\nLinha dois" })]);
  expect(output).toContain("mensagens carregadas");
  expect(output).toContain("Pessoa: Olá ❤️\nLinha dois");
  expect(output).toContain("09:00:00");
});
it("does not recover revoked content and orders a copy of the snapshot", () => {
  const items = [message({ id:"new",sentAt:"2026-10-10T13:00:00Z",revoked:true,body:"conteúdo removido" }),message({id:"old",kind:"document",body:null,mediaName:"arquivo.pdf",direction:"out"})];
  const output = conversationExport("Contato",items);
  expect(output).not.toContain("conteúdo removido");
  expect(output).toContain("Mensagem apagada");
  expect(output).toContain("arquivo.pdf");
  expect(output.indexOf("arquivo.pdf")).toBeLessThan(output.indexOf("Mensagem apagada"));
  expect(items[0].id).toBe("new");
});
