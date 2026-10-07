import { describe, expect, it } from "vitest";
import { colorFor, conversationTitle, dayLabel, formatWhatsAppPhone, initialsOf, listTime } from "@/modules/whatsapp/inbox-format";

const now = new Date(2026, 9, 7, 14, 0); // quarta-feira, 7/10/2026 14:00 (hora local)
const at = (day: number, hour = 9, minute = 5) => new Date(2026, 9, day, hour, minute).toISOString();

describe("datas como no WhatsApp", () => {
  it("lista de conversas", () => {
    expect(listTime(at(7), now)).toBe("09:05");
    expect(listTime(at(6), now)).toBe("Ontem");
    expect(listTime(at(5), now)).toBe("segunda-feira");
    expect(listTime(at(1), now)).toBe("quinta-feira");
    expect(listTime(new Date(2026, 8, 1, 9).toISOString(), now)).toBe("01/09/2026");
    expect(listTime(null, now)).toBe("");
  });

  it("separadores dentro da conversa", () => {
    expect(dayLabel(at(7), now)).toBe("Hoje");
    expect(dayLabel(at(6), now)).toBe("Ontem");
    expect(dayLabel(at(5), now)).toBe("Segunda-feira");
    expect(dayLabel(new Date(2026, 8, 28).toISOString(), now)).toBe("28/09/2026");
  });
});

describe("contatos", () => {
  it("telefone no formato do WhatsApp", () => {
    expect(formatWhatsAppPhone("5586995560428")).toBe("+55 86 99556-0428");
    expect(formatWhatsAppPhone("558694037823")).toBe("+55 86 9403-7823");
    expect(formatWhatsAppPhone("14155550100")).toBe("+14155550100");
    expect(formatWhatsAppPhone("120363000000000001@g.us")).toBe("120363000000000001@g.us");
  });

  it("título, iniciais e cor estável", () => {
    expect(conversationTitle({ title: null, remoteId: "5586995560428", isGroup: false })).toBe("+55 86 99556-0428");
    expect(conversationTitle({ title: null, remoteId: "1@g.us", isGroup: true })).toBe("Grupo");
    expect(conversationTitle({ title: "Maria", remoteId: "1", isGroup: false })).toBe("Maria");
    expect(initialsOf("Colégio Crescer")).toBe("CC");
    expect(initialsOf("João")).toBe("JO");
    expect(colorFor("Maria")).toBe(colorFor("Maria"));
  });
});
