import type { InboxChannel, InboxConversation, InboxMessageItem } from "./inbox-types";

// Fictitious conversations for /demo/whatsapp (times relative to now, so "Hoje"/"Ontem" stay right).
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

export const demoInboxChannels: InboxChannel[] = [
  { key: "00000000-0000-4000-8000-0000000000e1", kind: "official", name: "Relatórios", phone: "+55 86 9403-7823", coexistence: false },
  { key: "00000000-0000-4000-8000-0000000000e2", kind: "official", name: "Atendimento", phone: "+55 86 99556-0428", coexistence: true },
];

const conversation = (partial: Partial<InboxConversation> & Pick<InboxConversation, "id" | "channelKey" | "remoteId">): InboxConversation => ({
  isGroup: false, title: null, clientId: null, clientName: null, favorite: false, unread: 0, lastAt: null, preview: null,
  lastDirection: null, lastKind: "text", lastStatus: null, lastInboundAt: null, archived: false, ...partial,
});

export const demoInboxConversations: InboxConversation[] = [
  conversation({ id: "d1", channelKey: "qr", remoteId: "5586988214153", title: "Lindaiane Lívia", clientName: "Colégio Crescer", unread: 1, lastAt: minutesAgo(36), preview: "Oiê! Bom dia!!!! Não esqueceeee 🙏", lastDirection: "in", lastInboundAt: minutesAgo(36) }),
  conversation({ id: "d2", channelKey: "qr", remoteId: "120363000000000001@g.us", isGroup: true, title: "Diretoria Colégio Crescer", clientName: "Colégio Crescer", unread: 2, lastAt: minutesAgo(62), preview: "Os números da semana ficaram ótimos", lastDirection: "in" }),
  conversation({ id: "d3", channelKey: "qr", remoteId: "5586999990000", title: "Paulo Henrique", clientName: "RM Imobiliária", lastAt: minutesAgo(60 * 26), preview: "Pode ser, combinado", lastDirection: "out", lastStatus: "read" }),
  conversation({ id: "d4", channelKey: "qr", remoteId: "5586977773040", lastAt: minutesAgo(60 * 24 * 3), preview: "Relatorio-Escola-Horizonte.pdf", lastKind: "document", lastDirection: "out", lastStatus: "delivered", favorite: true }),
  conversation({ id: "d5", channelKey: demoInboxChannels[0].key, remoteId: "5586988887777", title: "Mariana Costa", clientName: "Escola Horizonte", unread: 1, lastAt: minutesAgo(18), preview: "Recebi! O CPC caiu bastante, né?", lastDirection: "in", lastInboundAt: minutesAgo(18) }),
  conversation({ id: "d6", channelKey: demoInboxChannels[0].key, remoteId: "5586977773040", title: "Paulo Henrique", clientName: "Escola Horizonte", lastAt: minutesAgo(60 * 5), preview: "Escola-Horizonte-2026-09-06-2026-10-05.pdf", lastKind: "document", lastDirection: "out", lastStatus: "read" }),
  conversation({ id: "d7", channelKey: demoInboxChannels[1].key, remoteId: "5586991112222", title: "Ana Beatriz", clientName: "Clínica Sotero", lastAt: minutesAgo(90), preview: "Áudio", lastKind: "audio", lastDirection: "in", lastInboundAt: minutesAgo(90) }),
];

const message = (id: string, direction: "in" | "out", minutes: number, body: string | null, extra: Partial<InboxMessageItem> = {}): InboxMessageItem => ({
  id, direction, kind: "text", body, mediaName: null, mediaMime: null, author: null, status: direction === "out" ? "read" : null, sentAt: minutesAgo(minutes), ...extra,
});

export const demoInboxThreads: Record<string, InboxMessageItem[]> = {
  d1: [
    message("m1", "in", 60 * 24 * 3 + 30, "Queria fazer um drive"),
    message("m2", "in", 60 * 24 * 3 + 29, "Pra ficar pra crescer"),
    message("m3", "in", 60 * 24 * 2, "Olá! Bom dia, Silvio. Tudo bem?!\n\nVocê consegue me enviar as logos em png da Crescer? A que eu tenho é de print e às vezes não tem uma qualidade boa."),
    message("m4", "out", 60 * 24 * 2 - 2, null, { kind: "audio" }),
    message("m5", "in", 60 * 24 * 2 - 3, "Show! Tá bom, vou ficar no aguardo 😌🙏"),
    message("m6", "in", 36, "Oiê! Bom dia!!!!\nNão esqueceeee 🙏", { reactions: [{ emoji: "❤️", count: 2, mine: true }, { emoji: "👍", count: 1, mine: false }] }),
  ],
  d2: [
    message("g1", "out", 60 * 3, "Bom dia, pessoal! Segue o *resumo da semana* do Colégio Crescer:\n\n💰 *Investimento:* R$ 727,43\n👀 *Alcance:* 50.836 pessoas\n🎯 *Resultados:* 14 cadastros concluídos\n\n_Para não receber mais estas mensagens, responda PARAR._"),
    message("g2", "in", 65, "Ótimo, obrigado!", { author: "Carlos Mendes" }),
    message("g3", "in", 62, "Os números da semana ficaram ótimos", { author: "Fernanda Lima" }),
  ],
  d3: [message("p1", "in", 60 * 27, "Consegue me mandar o relatório de setembro?"), message("p2", "out", 60 * 26, "Pode ser, combinado")],
  d4: [message("r1", "out", 60 * 24 * 3, null, { kind: "document", mediaName: "Relatorio-Escola-Horizonte.pdf", status: "delivered" })],
  d5: [
    message("o1", "out", 60 * 5, "Olá, Mariana! O relatório de desempenho de Escola Horizonte, referente ao período de 06/09/2026 a 05/10/2026, está no arquivo acima. Qualquer dúvida, fale com a equipe iGrow Digital por aqui.", { kind: "document", mediaName: "Escola-Horizonte-2026-09-06-2026-10-05.pdf" }),
    message("o2", "in", 18, "Recebi! O CPC caiu bastante, né?"),
  ],
  d6: [message("o3", "out", 60 * 5, "Olá, Paulo! O relatório de desempenho de Escola Horizonte, referente ao período de 06/09/2026 a 05/10/2026, está no arquivo acima. Qualquer dúvida, fale com a equipe iGrow Digital por aqui.", { kind: "document", mediaName: "Escola-Horizonte-2026-09-06-2026-10-05.pdf" })],
  d7: [message("a1", "in", 90, null, { kind: "audio" })],
};
